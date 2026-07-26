import fs from "node:fs";
import path from "node:path";

const logoPath = path.join(process.cwd(), "public", "brand", "public-map-logo.png");

export const BRAND_LOGO_DATA_URI = `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`;
