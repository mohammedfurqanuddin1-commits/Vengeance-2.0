// INNOBLOCK 2.0 PS 42 Configuration File
const CONFIG = {
  API_BASE_URL: "http://127.0.0.1:5000",
  // Update CONTRACT_ADDRESS after compiling & deploying contracts/RentalEscrow.sol in Remix or Hardhat
  CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000000",
  
  // Smart Contract ABI (Matches contracts/RentalEscrow.sol)
  ABI: [
    "function listProperty(address _tenant, uint256 _rent, uint256 _deposit, uint256 _durationMonths, bytes32 _leaseHash) external returns (uint256)",
    "function signAndDeposit(uint256 _propertyId) external payable",
    "function releaseMonthlyRent(uint256 _propertyId) external payable",
    "function applyLatePenalty(uint256 _propertyId) external",
    "function endLease(uint256 _propertyId, uint256 _deductionAmount) external",
    "function verifyLease(uint256 _propertyId, bytes32 _inputHash) external view returns (bool)",
    "function getProperty(uint256 _propertyId) external view returns (uint256 id, address landlord, address tenant, uint256 rent, uint256 deposit, uint256 durationMonths, bytes32 leaseHash, uint8 state, uint256 totalRentPaid, uint256 latePenaltyAccumulated)",
    "event PropertyListed(uint256 indexed propertyId, address indexed landlord, address indexed tenant, uint256 rent, uint256 deposit, uint256 durationMonths, bytes32 leaseHash)",
    "event LeaseSignedAndFunded(uint256 indexed propertyId, address indexed tenant, uint256 totalValueSent)",
    "event RentReleased(uint256 indexed propertyId, address indexed landlord, uint256 amount)",
    "event LatePenaltyApplied(uint256 indexed propertyId, uint256 penaltyAmount)",
    "event LeaseEnded(uint256 indexed propertyId, uint256 deductionAmount, uint256 depositRefundedToTenant)"
  ]
};
