import { Chains, Pools, SnarkConfigParams } from 'zkbob-client-js';
var config = require('../client-config.json');

export interface ConsoleConfig {
    defaultPool: string;
    pools: Pools;
    chains: Chains;
    blockExplorerUrls: {[chainId: string]: {tx: string, address: string} };
    globalSnarks: SnarkConfigParams;
    minters: {[poolName: string]: string };
    cloudApi: {[poolName: string]: string };
    redemptionUrls: {[poolName: string]: string };
}

export const env = config as ConsoleConfig;