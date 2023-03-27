import { Chains, Pools } from 'zkbob-client-js/lib/config';
var config = require('../client-config.json');

export interface ConsoleConfig {
    pools: Pools;
    chains: Chains;
    blockExplorerUrls: {[chainId: string]: {tx: string, address: string} };
    defaultPool: string;
    minters: {[poolName: string]: string };
    cloudApi: {[poolName: string]: string };
    redemptionUrls: {[poolName: string]: string };
}

export const env = config as ConsoleConfig;