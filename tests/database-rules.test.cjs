const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const rules = JSON.parse(fs.readFileSync(path.join(root, "database.rules.json"), "utf8")).rules;
const sources = ["js", "games"].flatMap(dir => fs.readdirSync(path.join(root, dir))
    .filter(file => file.endsWith(".js")).map(file => fs.readFileSync(path.join(root, dir, file), "utf8"))).join("\n");

test("every database root the code uses has rules, and everything else is denied", () => {
    const roots = new Set();
    for (const [, literal] of sources.matchAll(/\bdb\.(?:subscribe|get|set|update|remove|transaction|push|onDisconnectRemove)\(\s*[`"']([a-z]+)[/`"']/g)) {
        roots.add(literal);
    }
    roots.add("rooms");
    assert.deepEqual([...roots].sort(), ["lobbies", "presence", "rooms"]);
    for (const name of roots) { assert.ok(rules[name], `${name} has rules`); }
    assert.equal(rules[".read"], false);
    assert.equal(rules[".write"], false);
});

test("every readable or writable location requires a signed-in user", () => {
    const visit = (node, location) => {
        for (const [key, value] of Object.entries(node)) {
            if ((key == ".read" || key == ".write") && value !== false) {
                assert.match(value, /^auth != null\b/, `${location}/${key}`);
            } else if (value && typeof value == "object" && !Array.isArray(value)) {
                visit(value, `${location}/${key}`);
            }
        }
    };
    visit(rules, "");
});

test("only members may change a room; anyone signed in may join a lobby as themselves", () => {
    const room = rules.rooms.$roomId;
    assert.match(room[".write"], /data\.child\('members'\)\.child\(auth\.uid\)\.exists\(\)/);
    assert.match(room.members.$uid[".write"], /auth\.uid == \$uid/);
    assert.match(room.members.$uid[".write"], /status'\)\.val\(\) == 'lobby'/);
});
