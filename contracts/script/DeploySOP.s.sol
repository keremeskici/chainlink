// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {OracleRegistry} from "../src/OracleRegistry.sol";
import {SOPVault} from "../src/SOPVault.sol";

contract DeploySOP is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address creAddress = vm.envAddress("CRE_WORKFLOW_ADDRESS");

        // Use a mock UMA address or one from env if deployed on testnet
        address umaTokenAddress = vm.envOr(
            "UMA_TOKEN_ADDRESS",
            address(0xb1D4538B4571d411F07960EF2838Ce337FE1E80E)
        );

        vm.startBroadcast(deployerPrivateKey);

        OracleRegistry registry = new OracleRegistry(creAddress);
        console.log("OracleRegistry deployed to:", address(registry));

        SOPVault vault = new SOPVault(umaTokenAddress);
        console.log("SOPVault deployed to:", address(vault));

        vm.stopBroadcast();
    }
}
