//@ts-check

'use strict';

const path = require('path');
const webpack = require('webpack');

/**@type {import('webpack').Configuration}*/
const nodeConfig = {
  target: 'node',

  entry: {
    extension: './src/extension.ts',
    schematronWorker: './src/workers/schematronWorker.ts'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  devtool: 'source-map',
  externals: {
    vscode: 'commonjs vscode',
    salve: 'salve'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  }
};

/**@type {import('webpack').Configuration}*/
const webExtensionConfig = {
  target: 'webworker',

  entry: {
    extension: './src/extension.ts'
  },
  output: {
    path: path.resolve(__dirname, 'dist/web'),
    filename: '[name].js',
    libraryTarget: 'commonjs',
    devtoolModuleFilenameTemplate: '../../[resource-path]'
  },
  devtool: 'source-map',
  externals: {
    vscode: 'commonjs vscode'
  },
  resolve: {
    mainFields: ['browser', 'module', 'main'],
    extensions: ['.ts', '.js'],
    fallback: {
      path: require.resolve('path-browserify'),
      buffer: require.resolve('buffer/'),
      process: require.resolve('process/browser'),
      util: require.resolve('util/'),
      stream: require.resolve('stream-browserify'),
      fs: false,
      child_process: false,
      worker_threads: false,
      url: false
    }
  },
  plugins: [
    new webpack.ProvidePlugin({
      process: 'process/browser',
      Buffer: ['buffer', 'Buffer']
    }),
    new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
      resource.request = resource.request.replace(/^node:/, '');
    })
  ],
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  performance: {
    hints: false
  }
};

// The web worker is started from a blob URL, so it must not be wrapped as a CommonJS module.
/**@type {import('webpack').Configuration}*/
const webWorkerConfig = {
  ...webExtensionConfig,
  entry: {
    schematronWorker: './src/workers/schematronWorker.web.ts'
  },
  output: {
    path: path.resolve(__dirname, 'dist/web'),
    filename: '[name].js',
    devtoolModuleFilenameTemplate: '../../[resource-path]'
  },
  externals: {}
};

module.exports = [nodeConfig, webExtensionConfig, webWorkerConfig];