const CompressionPlugin = require('compression-webpack-plugin');
const merge = require('webpack-merge').merge;
const common = require('./webpack.config.js');

module.exports = merge(common, {
    devtool: false,
    mode: 'production',
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                enforce: 'pre',
                loader: 'ts-loader',
                exclude: /node_modules/,
                options: {
                    configFile: 'tsconfig.prod.json'
                }
            }
        ],
    },
    plugins: [new CompressionPlugin({ exclude: 'env.js' })]
});