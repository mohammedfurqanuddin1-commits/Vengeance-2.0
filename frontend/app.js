// State variables
let userSigner = null;
let userAddress = null;
let provider = null;
let currentPropertyData = null;

// Helper: Truncate Ethereum Address
function truncateAddress(addr) {
  if (!addr) return "";
  return addr.substring(0, 6) + "..." + addr.substring(addr.length - 4);
}

// Helper: Calculate SHA-256 in browser using Web Crypto API
async function sha256Browser(message) {
  const msgBuffer = new TextEncoder().encode(message.trim());
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hexHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return {
    rawHex: hexHash,
    bytes32: "0x" + hexHash
  };
}

// -----------------------------------------------------------------------------
// STEP 1: WALLET CONNECTION & PROPERTY LISTING (LANDLORD VIEW)
// -----------------------------------------------------------------------------
async function connectWallet() {
  if (typeof window.ethereum === "undefined") {
    alert("MetaMask is not installed. Please install MetaMask to interact with Web3.");
    return;
  }

  try {
    provider = new ethers.providers.Web3Provider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    userSigner = provider.getSigner();
    userAddress = await userSigner.getAddress();

    const balanceWei = await provider.getBalance(userAddress);
    const balanceEth = parseFloat(ethers.utils.formatEther(balanceWei)).toFixed(4);
    const network = await provider.getNetwork();

    document.getElementById("walletStatusText").textContent = "Connected";
    document.getElementById("walletStatusText").className = "badge badge-green";
    document.getElementById("walletAddressText").textContent = truncateAddress(userAddress);
    document.getElementById("walletBalanceText").textContent = `${balanceEth} ETH (${network.name})`;

    if (!document.getElementById("landlordAddr").value) {
      document.getElementById("landlordAddr").value = userAddress;
    }

    console.log(`Connected wallet: ${userAddress} on chain ${network.chainId}`);
  } catch (err) {
    console.error("Wallet connection failed:", err);
    alert("Failed to connect wallet: " + err.message);
  }
}

document.getElementById("listPropertyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const landlord = document.getElementById("landlordAddr").value.trim();
  const tenant = document.getElementById("tenantAddr").value.trim();
  const rentEth = parseFloat(document.getElementById("rentEth").value);
  const depositEth = parseFloat(document.getElementById("depositEth").value);
  const durationMonths = parseInt(document.getElementById("durationMonths").value);
  const termsText = document.getElementById("termsText").value.trim();

  const btn = document.getElementById("submitListBtn");
  btn.disabled = true;
  btn.textContent = "Processing Off-Chain Registration...";

  try {
    const res = await fetch(`${CONFIG.API_BASE_URL}/api/list-property`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        landlord,
        tenant,
        rent_eth: rentEth,
        deposit_eth: depositEth,
        duration_months: durationMonths,
        terms_text: termsText
      })
    });

    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Failed to list property");

    const totalFunding = (rentEth + depositEth).toFixed(4);
    document.getElementById("resPropertyId").textContent = `#${data.property_id}`;
    document.getElementById("resTotalFunding").textContent = `${totalFunding} ETH`;
    document.getElementById("resBytes32Hash").textContent = data.bytes32_hash;
    document.getElementById("listResultBox").style.display = "block";

    // Auto fill Property ID in Steps 2, 3, 4
    document.getElementById("step2PropertyIdInput").value = data.property_id;
    document.getElementById("step3PropertyId").value = data.property_id;
    document.getElementById("step4PropertyId").value = data.property_id;
    document.getElementById("monthlyRentEth").value = rentEth;
    document.getElementById("verifyTermsText").value = termsText;

    alert(`Property #${data.property_id} listed!\nSHA-256 On-Chain Fingerprint: ${data.bytes32_hash}`);
  } catch (err) {
    alert("Error listing property: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "📝 List Property & Register SHA-256";
  }
});

// -----------------------------------------------------------------------------
// STEP 2: SIGN LEASE & LOCK ESCROW (TENANT VIEW)
// -----------------------------------------------------------------------------
document.getElementById("fetchPropertyBtn").addEventListener("click", async () => {
  const propertyId = document.getElementById("step2PropertyIdInput").value;
  if (!propertyId) {
    alert("Please enter a valid Property ID");
    return;
  }

  try {
    const res = await fetch(`${CONFIG.API_BASE_URL}/api/property/${propertyId}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Property not found");

    currentPropertyData = data.property;
    const totalInitial = (currentPropertyData.rent_eth + currentPropertyData.deposit_eth).toFixed(4);

    document.getElementById("propLandlord").textContent = truncateAddress(currentPropertyData.landlord);
    document.getElementById("propTenant").textContent = truncateAddress(currentPropertyData.tenant);
    document.getElementById("propRent").textContent = `${currentPropertyData.rent_eth} ETH`;
    document.getElementById("propDeposit").textContent = `${currentPropertyData.deposit_eth} ETH`;
    document.getElementById("propTotalInitial").textContent = `${totalInitial} ETH`;
    document.getElementById("propStatus").textContent = currentPropertyData.status;

    document.getElementById("propertyDetailsBox").style.display = "block";
    document.getElementById("signAndDepositBtn").disabled = false;
  } catch (err) {
    alert("Could not fetch property: " + err.message);
  }
});

document.getElementById("signAndDepositBtn").addEventListener("click", async () => {
  if (!currentPropertyData) {
    alert("Please fetch property details first.");
    return;
  }
  if (!userSigner) {
    alert("Please connect MetaMask first.");
    await connectWallet();
    return;
  }

  const btn = document.getElementById("signAndDepositBtn");
  btn.disabled = true;
  btn.textContent = "Sending Escrow Funding Transaction...";

  try {
    const totalEth = (currentPropertyData.rent_eth + currentPropertyData.deposit_eth).toString();
    const valueWei = ethers.utils.parseEther(totalEth);

    if (CONFIG.CONTRACT_ADDRESS === "0x0000000000000000000000000000000000000000") {
      const confirmDemo = confirm(
        `Contract address in config.js is default (0x00...00).\nSimulate successful Escrow Funding of ${totalEth} ETH (Deposit + 1st Month Rent)?`
      );
      if (confirmDemo) {
        currentPropertyData.status = "Active";
        document.getElementById("propStatus").textContent = "Active (Escrow Funded)";
        document.getElementById("propStatus").className = "badge badge-green";
        alert(`Success! Lease signed and ${totalEth} ETH (Deposit + 1st Month Rent) locked into Escrow.`);
        return;
      }
    }

    const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.ABI, userSigner);
    const tx = await contract.signAndDeposit(currentPropertyData.id, { value: valueWei });
    await tx.wait();

    currentPropertyData.status = "Active";
    document.getElementById("propStatus").textContent = "Active (Escrow Funded)";
    document.getElementById("propStatus").className = "badge badge-green";
    alert(`Tx Confirmed! Lease signed and Escrow funded. Tx Hash: ${tx.hash}`);

  } catch (err) {
    console.error("Sign and deposit failed:", err);
    alert("Transaction failed: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "✍️ Sign & Deposit (Deposit + 1st Month Rent)";
  }
});

// -----------------------------------------------------------------------------
// STEP 3: RENT RELEASE & LATE PENALTY
// -----------------------------------------------------------------------------
document.getElementById("releaseRentBtn").addEventListener("click", async () => {
  const propertyId = document.getElementById("step3PropertyId").value;
  const rentEth = document.getElementById("monthlyRentEth").value || "0.2";

  if (!propertyId) {
    alert("Please enter a Property ID.");
    return;
  }

  const btn = document.getElementById("releaseRentBtn");
  btn.disabled = true;

  try {
    if (CONFIG.CONTRACT_ADDRESS === "0x0000000000000000000000000000000000000000") {
      document.getElementById("step3StatusText").textContent = `✅ Released ${rentEth} ETH monthly rent to landlord (Simulated)`;
      document.getElementById("step3ResultBox").style.display = "block";
      alert(`Released ${rentEth} ETH monthly rent to Landlord!`);
      return;
    }

    const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.ABI, userSigner);
    const valueWei = ethers.utils.parseEther(rentEth);
    const tx = await contract.releaseMonthlyRent(propertyId, { value: valueWei });
    await tx.wait();

    document.getElementById("step3StatusText").textContent = `✅ Released ${rentEth} ETH monthly rent to landlord. Tx: ${tx.hash}`;
    document.getElementById("step3ResultBox").style.display = "block";
    alert(`Tx Confirmed! Released ${rentEth} ETH rent to Landlord.`);
  } catch (err) {
    alert("Rent release failed: " + err.message);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("applyPenaltyBtn").addEventListener("click", async () => {
  const propertyId = document.getElementById("step3PropertyId").value;
  if (!propertyId) {
    alert("Please enter a Property ID.");
    return;
  }

  try {
    if (CONFIG.CONTRACT_ADDRESS === "0x0000000000000000000000000000000000000000") {
      document.getElementById("step3StatusText").textContent = `⚠️ Applied 5% late penalty (Simulated calculation)`;
      document.getElementById("step3ResultBox").style.display = "block";
      alert("Late penalty of 5% applied!");
      return;
    }

    const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.ABI, userSigner);
    const tx = await contract.applyLatePenalty(propertyId);
    await tx.wait();

    document.getElementById("step3StatusText").textContent = `⚠️ Late penalty applied on-chain. Tx: ${tx.hash}`;
    document.getElementById("step3ResultBox").style.display = "block";
  } catch (err) {
    alert("Late penalty trigger failed: " + err.message);
  }
});

// -----------------------------------------------------------------------------
// STEP 4: LEASE END DEPOSIT REFUND, AI DISPUTE & VERIFICATION
// -----------------------------------------------------------------------------
document.getElementById("evaluateDisputeBtn").addEventListener("click", async () => {
  const propertyId = document.getElementById("step4PropertyId").value || 1;
  const inspectionNotes = document.getElementById("inspectionNotes").value;
  const tenantStatement = document.getElementById("tenantStatement").value;
  const landlordStatement = document.getElementById("landlordStatement").value;

  const btn = document.getElementById("evaluateDisputeBtn");
  btn.disabled = true;
  btn.textContent = "Analyzing via AI...";

  try {
    const res = await fetch(`${CONFIG.API_BASE_URL}/api/ai-arbitrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        property_id: parseInt(propertyId),
        inspection_notes: inspectionNotes,
        tenant_statement: tenantStatement,
        landlord_statement: landlordStatement
      })
    });

    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Arbitration failed");

    document.getElementById("aiDeductionEth").textContent = `${data.recommended_deduction_eth} ETH`;
    document.getElementById("aiRefundPct").textContent = `${data.refund_percentage}%`;
    document.getElementById("aiReasoningText").textContent = data.ai_reasoning;
    document.getElementById("aiResultBox").style.display = "block";

    // Auto-fill deduction input in End Lease section
    document.getElementById("deductionAmountEth").value = data.recommended_deduction_eth;
  } catch (err) {
    alert("AI arbitration failed: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🤖 Run AI Dispute Arbitrator";
  }
});

document.getElementById("endLeaseBtn").addEventListener("click", async () => {
  const propertyId = document.getElementById("step4PropertyId").value;
  const deductionEth = document.getElementById("deductionAmountEth").value || "0";

  if (!propertyId) {
    alert("Please enter a Property ID.");
    return;
  }

  const btn = document.getElementById("endLeaseBtn");
  btn.disabled = true;

  try {
    if (CONFIG.CONTRACT_ADDRESS === "0x0000000000000000000000000000000000000000") {
      alert(`Lease #${propertyId} Completed!\nDeduction: ${deductionEth} ETH to Landlord.\nRemaining deposit refunded to Tenant.`);
      return;
    }

    const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.ABI, userSigner);
    const deductionWei = ethers.utils.parseEther(deductionEth);
    const tx = await contract.endLease(propertyId, deductionWei);
    await tx.wait();

    alert(`Tx Confirmed! Lease #${propertyId} Completed on-chain. Remaining deposit returned to Tenant. Tx: ${tx.hash}`);
  } catch (err) {
    alert("End lease failed: " + err.message);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("verifyIntegrityBtn").addEventListener("click", async () => {
  const propertyId = document.getElementById("step4PropertyId").value;
  const termsText = document.getElementById("verifyTermsText").value.trim();

  if (!termsText) {
    alert("Please paste the lease text to verify.");
    return;
  }

  try {
    const computed = await sha256Browser(termsText);
    document.getElementById("verifyMatchBox").style.display = "none";
    document.getElementById("verifyMismatchBox").style.display = "none";

    let expectedHash = null;

    if (propertyId) {
      const res = await fetch(`${CONFIG.API_BASE_URL}/api/property/${propertyId}`);
      const data = await res.json();
      if (data.ok && data.property) {
        expectedHash = data.property.bytes32_hash;
      }
    }

    if (expectedHash && computed.bytes32.toLowerCase() === expectedHash.toLowerCase()) {
      document.getElementById("verifyHashMatched").textContent = `SHA-256: ${computed.bytes32}`;
      document.getElementById("verifyMatchBox").style.display = "block";
    } else if (!expectedHash) {
      document.getElementById("verifyHashMatched").textContent = `Computed Fingerprint: ${computed.bytes32}`;
      document.getElementById("verifyMatchBox").style.display = "block";
    } else {
      document.getElementById("verifyHashMismatch").textContent = `Computed: ${computed.bytes32}\nExpected: ${expectedHash}`;
      document.getElementById("verifyMismatchBox").style.display = "block";
    }
  } catch (err) {
    alert("Verification error: " + err.message);
  }
});

// Bind Wallet Buttons
document.getElementById("connectWalletBtn").addEventListener("click", connectWallet);

window.addEventListener("load", () => {
  if (typeof window.ethereum !== "undefined") {
    provider = new ethers.providers.Web3Provider(window.ethereum);
    provider.listAccounts().then(accounts => {
      if (accounts.length > 0) connectWallet();
    });
  }
});
