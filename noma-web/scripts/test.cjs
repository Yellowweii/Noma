const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};

require("../src/lib/haConnectionSnapshot.test.cjs");
require("../src/lib/homeSnapshot.test.cjs");
require("../src/app/(dashboard)/home/home-device-control.test.ts");
require("../src/app/(dashboard)/home/DeviceCard.test.cjs");
require("../src/lib/localId.test.cjs");
require("../src/lib/auth.test.cjs");
require("../src/lib/loginCompletion.test.cjs");
require("../src/components/settings/HASettingsContent.test.cjs");
