# INNOBLOCK 2.0 Hackathon: Property Rental Platform with Smart Escrow

A full-stack Web3 property rental dApp preventing deposit fraud and landlord ghosting using smart contract escrow on Ethereum Sepolia, Flask off-chain storage, SHA-256 agreement verification, and Google Gemini AI dispute resolution.

---

## 🏗️ Architecture & Ground Rules

1. **Off-Chain vs On-Chain**:
   - **Full Rental Details**: Stored off-chain in SQLite database (`backend/rentals.db`).
   - **Immutable Fingerprints**: 32-byte SHA-256 hashes (`bytes32`) stored on-chain in `RentalEscrow.sol`.
2. **Target Network**: Ethereum Sepolia testnet (EVM) or local EVM node (Anvil / Hardhat).
3. **Security**: Private keys and API keys strictly live in `backend/.env`.

---

## 📁 Project Structure

```
.
├── contracts/
│   └── RentalEscrow.sol         # Solidity smart contract (^0.8.20)
├── backend/
│   ├── app.py                   # Flask API backend server
│   ├── requirements.txt         # Python package dependencies
│   ├── .env.example             # Environment variable template
│   └── rentals.db               # SQLite database (auto-generated)
├── frontend/
│   ├── index.html               # Glassmorphic Web3 User Interface
│   ├── styles.css               # Modern dark-mode styling
│   └── app.js                   # Ethers.js integration & card logic
└── README.md                    # Setup & Execution Guide
```

---

## 🚀 Step-by-Step Setup & Execution Guide

### Step 1: Smart Contract Compilation & Deployment (Remix IDE)

1. Open [Remix Ethereum IDE](https://remix.ethereum.org/).
2. Create a file named `RentalEscrow.sol` in Remix and copy the code from [`contracts/RentalEscrow.sol`](contracts/RentalEscrow.sol).
3. Under the **Solidity Compiler** tab:
   - Select compiler version `0.8.20` or higher.
   - Click **Compile RentalEscrow.sol**.
4. Under the **Deploy & Run Transactions** tab:
   - Select **Injected Provider - MetaMask** as the environment (switch MetaMask to Sepolia Testnet).
   - Click **Deploy**.
5. Copy the deployed contract address (e.g. `0x1234...5678`).
6. Update `contractAddress` in `frontend/app.js` with your deployed contract address.

---

### Step 2: Start the Flask Backend Server

1. Open a terminal in the `backend/` directory:
   ```bash
   cd backend
   ```
2. Create and activate a Python virtual environment (optional but recommended):
   ```bash
   python -m venv venv
   # On Windows:
   venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Configure environment variables (optional for Gemini AI):
   ```bash
   copy .env.example .env
   ```
   *(Add your `GEMINI_API_KEY` in `.env` if you wish to use live Google Gemini AI; otherwise, the built-in impartial AI evaluator runs automatically).*
5. Run the Flask server:
   ```bash
   python app.py
   ```
   The backend will start at `http://127.0.0.1:5000`.

---

### Step 3: Run the Frontend UI

1. Simply open [`frontend/index.html`](frontend/index.html) directly in any modern browser (or use VS Code Live Server / `python -m http.server 8000` in the `frontend` folder).
2. Ensure **MetaMask** extension is installed in your browser.

---

## 🧪 Testing the Full dApp Lifecycle

1. **Card 1: Connect Wallet**:
   - Click **Connect MetaMask**. The UI displays your address, ETH balance, and Sepolia status.
2. **Card 0: Create Lease Agreement**:
   - Enter Landlord address, Tenant address, Deposit in ETH (e.g., `0.05`), and Lease text.
   - Click **Save Off-Chain & Compute SHA-256**.
   - Note the generated **Lease ID** (e.g., `#1`) and **SHA-256 Fingerprint**.
3. **Card 2: Deposit Escrow (Tenant View)**:
   - Enter Lease ID `#1` and click **Fetch**.
   - Click **Lock Deposit in Escrow**. MetaMask will trigger a transaction to deposit ETH into smart escrow.
4. **Card 3: AI Inspection & Dispute Evaluator**:
   - Enter inspection notes (e.g. *"Property returned clean, minor wall wear"*) and statements.
   - Click **Evaluate Dispute via AI** to receive an automated impartial resolution recommendation & refund percentage.
5. **Card 4: On-Chain Integrity Verification**:
   - Enter Lease ID `#1` and paste the lease text.
   - Click **Verify On-Chain Integrity**. The app checks the text's SHA-256 fingerprint against the stored hash and displays a **Green Match Badge** (or **Red Alert** if tampered).

---

## 🛠️ Health Monitoring

Check backend status at any time:
```bash
curl http://127.0.0.1:5000/health
```
Returns: `{"ok": true, "service": "RentalEscrow Flask Backend", "status": "running"}`
