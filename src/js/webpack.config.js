// Webpack config file.

module.exports = {
    // Let's just turn off the minimizer here, by always using the "development"
    // mode: not sure why, but with minimization enabled here, the resulting
    // source map does not work for browsers (Chrome or Firefox), making
    // debugging pretty much impossible.
    //
    // So, instead we always create `croquis_fe_dev.js` here, without
    // minimization.  When we build the package, we call "terser" ourselves
    // after webpack, which creates `croquis_fe.js` (with the correct source
    // map) which is then included in the final package: see CMakeLists.txt for
    // details.
    mode: 'development',

    entry: './main.js',
    output: {
        filename: './croquis_fe_dev.js',
        libraryTarget: 'amd',
        clean: true,
    },
    resolve: {
        // Disable default dependency resolution: we're not including *any*
        // external libraries into the bundle.
        modules: [],
    },
    devtool: 'source-map',
    stats: 'errors-only',
};
