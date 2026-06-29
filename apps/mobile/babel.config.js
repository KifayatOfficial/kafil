module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-reanimated/plugin MUST be the LAST plugin (per Reanimated docs).
    plugins: ['react-native-reanimated/plugin'],
  };
};
