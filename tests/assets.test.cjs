const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pages, assetRevision, stampPage } = require("../scripts/stamp-revs.cjs");

const root = path.join(__dirname, "..");

for (const page of pages) {
    test(`${page} references every local script and stylesheet with its current content revision`, () => {
        const html = fs.readFileSync(path.join(root, page), "utf8");
        const references = Array.from(html.matchAll(/(?:src|href)="((?:js|css|games)\/[^"]+)"/g), match => match[1]);
        assert.ok(references.length > 0);
        for (const reference of references) {
            const [asset, query] = reference.split("?");
            assert.ok(fs.existsSync(path.join(root, asset)), `${asset} exists`);
            assert.equal(query, `rev=${assetRevision(asset)}`, `${asset} changed; run "npm run stamp"`);
        }
        assert.equal(stampPage(html), html);
    });
}

test("index.html loads every engine script and game, engine first", () => {
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const order = Array.from(html.matchAll(/<script src="((?:js|games)\/[\w.-]+\.js)/g), match => match[1]);
    const files = ["js", "games"].flatMap(dir => fs.readdirSync(path.join(root, dir))
        .filter(file => file.endsWith(".js")).map(file => `${dir}/${file}`));
    assert.deepEqual([...order].sort(), files.sort());
    const lastGame = Math.max(...order.map((file, index) => file.startsWith("games/") ? index : -1));
    assert.ok(order.indexOf("js/games.js") < order.findIndex(file => file.startsWith("games/")), "Registry before games");
    assert.ok(lastGame < order.indexOf("js/room.js"), "Games register before the room and app start");
    assert.equal(order.at(-1), "js/app.js");
});
