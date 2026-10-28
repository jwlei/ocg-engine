// Stamps every local script and stylesheet reference with a content hash (?rev=<hash>),
// so browsers fetch a fresh copy exactly when a file changes. Run: npm run stamp
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.join(__dirname, "..");
const pages = ["index.html"];
const assetPattern = /((?:src|href)=")((?:js|css|games)\/[\w.-]+\.(?:js|css))(?:\?rev=[\w.-]*)?(")/g;

function assetRevision(asset) {
    // Hash with normalized line endings so Windows and Linux checkouts agree.
    const content = fs.readFileSync(path.join(root, asset), "utf8").replace(/\r\n/g, "\n");
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 8);
}

function stampPage(html) {
    return html.replace(assetPattern, (match, prefix, asset, suffix) =>
        `${prefix}${asset}?rev=${assetRevision(asset)}${suffix}`);
}

if (require.main === module) {
    for (const page of pages) {
        const file = path.join(root, page);
        const html = fs.readFileSync(file, "utf8");
        const stamped = stampPage(html);
        if (stamped != html) {
            fs.writeFileSync(file, stamped);
            console.log(`Updated ${page}`);
        }
    }
}

module.exports = { pages, assetRevision, stampPage };
