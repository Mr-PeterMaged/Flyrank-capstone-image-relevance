import { createHash,randomBytes,scrypt as callback,timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt=promisify(callback);
export const digest=(s)=>createHash('sha256').update(s).digest('hex');
export const token=()=>randomBytes(32).toString('base64url');
export async function passwordHash(password) { const salt=randomBytes(16).toString('hex'); const key=await scrypt(password,salt,64); return `${salt}:${key.toString('hex')}`; }
export async function passwordMatches(password,encoded) { const [salt,hex]=encoded.split(':'); const key=await scrypt(password,salt,64); return timingSafeEqual(key,Buffer.from(hex,'hex')); }
