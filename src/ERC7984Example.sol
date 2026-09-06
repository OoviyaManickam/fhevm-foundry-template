// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {FHE, externalEuint64, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";

contract ERC7984Example is ZamaEthereumConfig, ERC7984, Ownable2Step {
    constructor(
        address owner,
        uint64 amount,
        string memory name_,
        string memory symbol_,
        string memory contractURI_
    ) ERC7984(name_, symbol_, contractURI_) Ownable(owner) {
        euint64 encryptedAmount = FHE.asEuint64(amount);
        _mint(owner, encryptedAmount);
    }

    /// @notice Mints an encrypted amount of tokens to `to`.
    function confidentialMint(address to, externalEuint64 encryptedAmount, bytes calldata inputProof)
        external
        onlyOwner
        returns (euint64 transferred)
    {
        return _mint(to, FHE.fromExternal(encryptedAmount, inputProof));
    }

    /// @notice Burns an encrypted amount of tokens from `from`.
    function confidentialBurn(address from, externalEuint64 encryptedAmount, bytes calldata inputProof)
        external
        onlyOwner
        returns (euint64 transferred)
    {
        return _burn(from, FHE.fromExternal(encryptedAmount, inputProof));
    }
}
