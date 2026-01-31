const path = require("path");

/**
 * Webpack config for building the Adjutorix VS Code extension.
 * Bundles TypeScript into a single extension.js file.
 */

module.exports = {
  target: "node",

  entry: "./src/extension.ts",

  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "extension.js",
    libraryTarget: "commonjs2",
    devtoolModuleFilenameTemplate: "../[resource-path]"
  },

  devtool: "source-map",

  externals: {
    vscode: "commonjs vscode"
  },

  resolve: {
    extensions: [".ts", ".js", ".json"]
  },

  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
            options: {
              transpileOnly: true
            }
          }
        ]
      }
    ]
  },

  optimization: {
    minimize: false
  },

  infrastructureLogging: {
    level: "warn"
  },

  stats: {
    preset: "minimal"
  }
};
