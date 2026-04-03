module.exports = {
  apps: [
    {
      name: "bianxiaoque-h5",
      script: ".next/standalone/server.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};
