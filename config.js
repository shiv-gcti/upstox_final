require("dotenv").config();

const normalize = (value) => (value || "").trim();

module.exports = {
  API_KEY: normalize(process.env.UPSTOX_API_KEY),
  API_SECRET: normalize(process.env.UPSTOX_API_SECRET),
  REDIRECT_URI: normalize(process.env.REDIRECT_URI),
  TOKEN_FILE: "./token.json"
};