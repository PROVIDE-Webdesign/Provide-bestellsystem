import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function fixture(
  t,
  { project = 'project_id = "renamed-ci-stack"', api = "http://127.0.0.1:16321", ci = "true" } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "provide-realtime-env-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ["scripts", "supabase", "bin"]) mkdirSync(join(root, directory));
  copyFileSync(
    new URL("./ci-realtime-env.mjs", import.meta.url),
    join(root, "scripts/ci-realtime-env.mjs"),
  );
  writeFileSync(join(root, "supabase/config.toml"), `${project}\n[api]\nport = 16321\n`);
  const credentials = { ANON_KEY: "synthetic-publishable", SERVICE_ROLE_KEY: "synthetic-admin" };
  writeFileSync(
    join(root, "bin/supabase"),
    `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify({ API_URL: api, ...credentials }))});\n`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(root, "bin/docker"),
    `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(join(root, "docker-args.json"))}, JSON.stringify(process.argv.slice(2)));\nconsole.log(JSON.stringify([{ Config: { Env: ["API_JWT_SECRET=synthetic-jwt-secret"] } }]));\n`,
    { mode: 0o700 },
  );
  const envFile = join(root, "github-env");
  const result = spawnSync(process.execPath, [join(root, "scripts/ci-realtime-env.mjs")], {
    encoding: "utf8",
    env: {
      ...process.env,
      CI: ci,
      GITHUB_ENV: envFile,
      PATH: `${join(root, "bin")}:${process.env.PATH}`,
    },
  });
  return {
    result,
    env: existsSync(envFile) ? readFileSync(envFile, "utf8") : null,
    dockerArgs: existsSync(join(root, "docker-args.json"))
      ? JSON.parse(readFileSync(join(root, "docker-args.json"), "utf8"))
      : null,
  };
}

test("uses the configured local project after a rename and masks every credential", (t) => {
  const { result, env, dockerArgs } = fixture(t);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(dockerArgs, ["inspect", "supabase_realtime_renamed-ci-stack"]);
  assert.equal(
    env,
    "TEST_REALTIME_URL=http://127.0.0.1:16321\nTEST_REALTIME_KEY=synthetic-publishable\nTEST_REALTIME_JWT_SECRET=synthetic-jwt-secret\nTEST_AUTH_ADMIN_KEY=synthetic-admin\n",
  );
  for (const value of ["synthetic-publishable", "synthetic-admin", "synthetic-jwt-secret"]) {
    assert.ok(result.stdout.includes(`::add-mask::${value}\n`));
    assert.equal(result.stdout.replaceAll(`::add-mask::${value}\n`, "").includes(value), false);
    assert.equal(result.stderr.includes(value), false);
  }
});

test("rejects non-CI use and remote API origins before Docker or environment writes", (t) => {
  for (const options of [{ ci: "" }, { api: "https://remote.example.invalid" }]) {
    const { result, env, dockerArgs } = fixture(t, options);
    assert.notEqual(result.status, 0);
    assert.equal(env, null);
    assert.equal(dockerArgs, null);
  }
});

test("rejects missing, ambiguous and unsafe project identifiers", (t) => {
  for (const project of [
    "# no project",
    'project_id = "a"\nproject_id = "b"',
    'project_id = "../other"',
  ]) {
    const { result, env, dockerArgs } = fixture(t, { project });
    assert.notEqual(result.status, 0);
    assert.equal(env, null);
    assert.equal(dockerArgs, null);
  }
});
