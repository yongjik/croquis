module.exports = {
    "env": {
        "amd": true,
        "browser": true,

        // Let's use an older standard for now -
        // I don't think we really need es2021.
        "es2017": true,
        // "es2021": true
    },
    "extends": "eslint:recommended",
    "parserOptions": {
        "ecmaVersion": 2017  // default was 12
    },
    "rules": {
        "no-unused-vars": 0,  // Too many warnings.
        "no-constant-condition": 0,  // while (true) is valid code!  Sheesh...
    }
};
