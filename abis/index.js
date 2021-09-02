import fs from 'fs'
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TippingABI = JSON.parse(fs.readFileSync(`${__dirname}/Tipping.json`));
const ERC20ABI = JSON.parse(fs.readFileSync(`${__dirname}/ERC20.json`));

export { TippingABI, ERC20ABI }
