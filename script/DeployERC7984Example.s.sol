// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {ERC7984Example} from "../src/ERC7984Example.sol";

contract DeployERC7984Example is Script {
    function run() external {
        vm.startBroadcast();

        ERC7984Example token = new ERC7984Example(
            msg.sender, 1_000_000, "Confidential Token", "CTKN", "https://example.com/token"
        );
        console.log("ERC7984Example deployed at:", address(token));

        vm.stopBroadcast();
    }
}
