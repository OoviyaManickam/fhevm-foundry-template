// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title FoggyPotBalanceLedger
/// @notice Encrypted per-user deposit weight for one FoggyPot pool. Balance-at-draw-time only —
/// no history, no TWAB. Only the pool's Vault (credits on deposit, debits on withdraw) and its
/// PrizePool (credits prize winnings) may mutate balances.
contract FoggyPotBalanceLedger is ZamaEthereumConfig, Ownable {
    mapping(address => euint64) private _balances;
    mapping(address => bool) public isDepositor;
    address[] public depositors;

    address public vault;
    address public prizePool;

    event AuthorizedContractsSet(address indexed vault, address indexed prizePool);

    modifier onlyAuthorized() {
        require(msg.sender == vault || msg.sender == prizePool, "Ledger: not authorized");
        _;
    }

    constructor(address admin) Ownable(admin) {}

    /// @notice One-time wiring of the Vault and PrizePool allowed to mutate balances. Admin-only.
