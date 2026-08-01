module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-worklets-core lets the camera frame processor run pose
    // inference on its own thread instead of blocking JS — plugin must run
    // last so it sees the fully-transformed function bodies.
    plugins: ['react-native-worklets-core/plugin'],
  };
};
