// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RentalEscrow (PS 42 - Real Estate & Land Registry)
 * @dev Smart Contract Escrow for Property Rental Platform (INNOBLOCK 2.0).
 * Stores 32-byte SHA-256 lease fingerprints on-chain, handles tenant deposit + 1st month rent funding,
 * automated monthly rent releases, late payment penalties, AI/Arbitrator dispute resolution, and deposit refunds.
 */
contract RentalEscrow {
    enum State { Created, Active, Disputed, Completed }

    struct Property {
        uint256 id;
        address payable landlord;
        address payable tenant;
        uint256 rent;                     // Monthly rent in Wei
        uint256 deposit;                  // Security deposit in Wei
        uint256 durationMonths;           // Lease duration in months
        bytes32 leaseHash;               // 32-byte SHA-256 fingerprint of full off-chain terms
        State state;
        uint256 totalRentPaid;            // Total rent transferred to landlord
        uint256 lastRentPaymentTimestamp; // Timestamp of last rent payment/release
        uint256 latePenaltyAccumulated;  // Accumulated late fee penalties in Wei
        uint256 createdAt;
    }

    // Storage
    uint256 public propertyCounter;
    mapping(uint256 => Property) public properties;

    // Events
    event PropertyListed(
        uint256 indexed propertyId,
        address indexed landlord,
        address indexed tenant,
        uint256 rent,
        uint256 deposit,
        uint256 durationMonths,
        bytes32 leaseHash
    );

    event LeaseSignedAndFunded(
        uint256 indexed propertyId,
        address indexed tenant,
        uint256 totalValueSent
    );

    event RentReleased(
        uint256 indexed propertyId,
        address indexed landlord,
        uint256 amount
    );

    event LatePenaltyApplied(
        uint256 indexed propertyId,
        uint256 penaltyAmount
    );

    event LeaseEnded(
        uint256 indexed propertyId,
        uint256 deductionAmount,
        uint256 depositRefundedToTenant
    );

    // Modifiers
    modifier onlyLandlord(uint256 _propertyId) {
        require(msg.sender == properties[_propertyId].landlord, "Only landlord can call this");
        _;
    }

    modifier onlyTenant(uint256 _propertyId) {
        require(msg.sender == properties[_propertyId].tenant, "Only tenant can call this");
        _;
    }

    modifier inState(uint256 _propertyId, State _state) {
        require(properties[_propertyId].state == _state, "Invalid lease state for this action");
        _;
    }

    /**
     * @dev 1. Landlord lists a rental unit with rent, deposit, duration, and SHA-256 lease hash.
     */
    function listProperty(
        address payable _tenant,
        uint256 _rent,
        uint256 _deposit,
        uint256 _durationMonths,
        bytes32 _leaseHash
    ) external returns (uint256) {
        require(msg.sender != address(0), "Invalid landlord address");
        require(_tenant != address(0), "Invalid tenant address");
        require(_rent > 0, "Rent must be greater than zero");
        require(_deposit > 0, "Deposit must be greater than zero");
        require(_durationMonths > 0, "Duration must be at least 1 month");
        require(_leaseHash != bytes32(0), "Lease hash cannot be empty");

        propertyCounter++;
        uint256 newId = propertyCounter;

        properties[newId] = Property({
            id: newId,
            landlord: payable(msg.sender),
            tenant: _tenant,
            rent: _rent,
            deposit: _deposit,
            durationMonths: _durationMonths,
            leaseHash: _leaseHash,
            state: State.Created,
            totalRentPaid: 0,
            lastRentPaymentTimestamp: 0,
            latePenaltyAccumulated: 0,
            createdAt: block.timestamp
        });

        emit PropertyListed(newId, msg.sender, _tenant, _rent, _deposit, _durationMonths, _leaseHash);
        return newId;
    }

    /**
     * @dev 2. Tenant signs lease by paying Security Deposit + 1st Month Rent into Escrow.
     */
    function signAndDeposit(uint256 _propertyId)
        external
        payable
        inState(_propertyId, State.Created)
    {
        Property storage prop = properties[_propertyId];
        require(msg.sender == prop.tenant, "Only designated tenant can sign and deposit");
        
        uint256 requiredValue = prop.deposit + prop.rent;
        require(msg.value == requiredValue, "Must send exact total of (Deposit + 1st Month Rent)");

        prop.state = State.Active;
        prop.lastRentPaymentTimestamp = block.timestamp;

        // Release 1st month rent immediately to landlord from initial funding
        prop.totalRentPaid += prop.rent;
        (bool success, ) = prop.landlord.call{value: prop.rent}("");
        require(success, "Transfer of 1st month rent to landlord failed");

        emit LeaseSignedAndFunded(_propertyId, msg.sender, msg.value);
        emit RentReleased(_propertyId, prop.landlord, prop.rent);
    }

    /**
     * @dev 3. Release monthly rent from tenant or contract balance to landlord.
     */
    function releaseMonthlyRent(uint256 _propertyId)
        external
        payable
        inState(_propertyId, State.Active)
    {
        Property storage prop = properties[_propertyId];
        require(
            msg.sender == prop.tenant || msg.sender == prop.landlord,
            "Not authorized to trigger rent release"
        );

        uint256 rentAmount = prop.rent;
        
        // If tenant is paying current month rent
        if (msg.sender == prop.tenant) {
            require(msg.value == rentAmount, "Sent value must equal monthly rent");
            prop.totalRentPaid += rentAmount;
            prop.lastRentPaymentTimestamp = block.timestamp;
            (bool success, ) = prop.landlord.call{value: rentAmount}("");
            require(success, "Rent transfer to landlord failed");
        } else {
            // Landlord releasing available contract funds if tenant pre-funded
            require(address(this).balance >= rentAmount + prop.deposit, "Insufficient contract balance for rent release");
            prop.totalRentPaid += rentAmount;
            prop.lastRentPaymentTimestamp = block.timestamp;
            (bool success, ) = prop.landlord.call{value: rentAmount}("");
            require(success, "Rent transfer to landlord failed");
        }

        emit RentReleased(_propertyId, prop.landlord, rentAmount);
    }

    /**
     * @dev 4. Automated Late Penalty Calculation (Good-To-Have).
     * Adds 5% penalty if more than 30 days have elapsed since last payment.
     */
    function applyLatePenalty(uint256 _propertyId)
        external
        inState(_propertyId, State.Active)
    {
        Property storage prop = properties[_propertyId];
        require(block.timestamp > prop.lastRentPaymentTimestamp + 30 days, "Rent is not yet late");

        uint256 penalty = (prop.rent * 5) / 100; // 5% late penalty
        prop.latePenaltyAccumulated += penalty;

        emit LatePenaltyApplied(_propertyId, penalty);
    }

    /**
     * @dev 5. End Lease & Return Security Deposit (supporting agreed or AI/Arbitrator deduction).
     */
    function endLease(uint256 _propertyId, uint256 _deductionAmount)
        external
        inState(_propertyId, State.Active)
    {
        Property storage prop = properties[_propertyId];
        require(
            msg.sender == prop.landlord || msg.sender == prop.tenant,
            "Not authorized to end lease"
        );
        require(_deductionAmount <= prop.deposit, "Deduction cannot exceed total security deposit");

        uint256 totalDeduction = _deductionAmount + prop.latePenaltyAccumulated;
        if (totalDeduction > prop.deposit) {
            totalDeduction = prop.deposit;
        }

        uint256 depositRefund = prop.deposit - totalDeduction;
        prop.state = State.Completed;

        // Transfer deduction + late penalty to landlord if any
        if (totalDeduction > 0) {
            (bool successLandlord, ) = prop.landlord.call{value: totalDeduction}("");
            require(successLandlord, "Deduction transfer to landlord failed");
        }

        // Refund remaining deposit to tenant
        if (depositRefund > 0) {
            (bool successTenant, ) = prop.tenant.call{value: depositRefund}("");
            require(successTenant, "Deposit refund to tenant failed");
        }

        emit LeaseEnded(_propertyId, totalDeduction, depositRefund);
    }

    /**
     * @dev 6. On-chain Verification of off-chain document text against stored SHA-256 hash.
     */
    function verifyLease(uint256 _propertyId, bytes32 _inputHash)
        external
        view
        returns (bool)
    {
        require(_propertyId > 0 && _propertyId <= propertyCounter, "Property does not exist");
        return properties[_propertyId].leaseHash == _inputHash;
    }

    /**
     * @dev Getter function for full property details.
     */
    function getProperty(uint256 _propertyId)
        external
        view
        returns (
            uint256 id,
            address landlord,
            address tenant,
            uint256 rent,
            uint256 deposit,
            uint256 durationMonths,
            bytes32 leaseHash,
            State state,
            uint256 totalRentPaid,
            uint256 latePenaltyAccumulated
        )
    {
        Property memory p = properties[_propertyId];
        return (
            p.id,
            p.landlord,
            p.tenant,
            p.rent,
            p.deposit,
            p.durationMonths,
            p.leaseHash,
            p.state,
            p.totalRentPaid,
            p.latePenaltyAccumulated
        );
    }
}
