const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function setup(parameter, state = "on") {
  const calls = [];
  const device = {
    id:"light.bulb", entity_id:"light.bulb", name:"智能灯泡", domain:"light", state,
    attributes:{ brightness:160 }, supported_actions:["turn_on", "turn_off"],
    action_params:{ turn_on:[parameter] },
  };
  const hookStates = new Map();
  let currentStates, index;
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react: {
      useEffect:() => {}, useRef:initial => ({ current:initial }),
      useState:initial => {
        const states = currentStates, slot = index++;
        if (!(slot in states)) states[slot] = initial;
        return [states[slot], value => { states[slot] = typeof value === "function" ? value(states[slot]) : value; }];
      },
    },
    "react/jsx-runtime":{ jsx, jsxs:jsx },
    "react-dom":{ createPortal:child => child },
    "lucide-react":new Proxy({}, { get:(_target, name) => `icon-${name}` }),
    "./home-devices":require("./home-devices.ts"),
    "./home-dashboard.module.css":{ __esModule:true, default:new Proxy({}, { get:(_target, name) => name }) },
  };
  const context = { exports:{}, document:{ body:{} }, require:name => { assert(name in modules, name); return modules[name]; } };
  const source = ts.transpileModule(readFileSync(join(__dirname,"DeviceCard.tsx"),"utf8"), {
    compilerOptions:{ module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.ReactJSX, target:ts.ScriptTarget.ES2022, esModuleInterop:true },
  }).outputText;
  vm.runInNewContext(source, context);
  function expand(tree) {
    if (Array.isArray(tree)) return tree.map(expand);
    if (!tree || typeof tree !== "object") return tree;
    if (typeof tree.type === "function") {
      if (!hookStates.has(tree.type)) hookStates.set(tree.type, []);
      currentStates = hookStates.get(tree.type); index = 0;
      return expand(tree.type(tree.props));
    }
    return { ...tree, props:{ ...tree.props, children:expand(tree.props.children) } };
  }
  return {
    calls,
    render:() => expand(jsx(context.exports.DeviceDetailPanel, {
      device, pending:false, onClose:() => {}, onControl:async (action, params) => { calls.push({ action, params }); return true; },
    })),
  };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree && typeof tree === "object" ? [tree, ...nodes(tree.props.children)] : [];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (tree == null || typeof tree === "boolean") return "";
  return typeof tree === "object" ? text(tree.props.children) : String(tree);
}
const namedButton = (tree, label) => nodes(tree).find(node => node.type === "button" && node.props["aria-label"] === label);

for (const [parameter, whiteChannels] of [["rgb_color", []], ["rgbw_color", [0]], ["rgbww_color", [0, 0]]]) {
  test(`${parameter} lights show the full palette and send native preset and custom colors`, async () => {
    const app = setup(parameter);
    let tree = app.render();
    const swatches = nodes(tree).filter(node => node.type === "button" && node.props.className === "colorSwatch");
    assert.equal(swatches.length, parameter === "rgb_color" ? 7 : 8);
    for (const color of ["暖黄", "橙", "红", "绿", "青", "蓝", "紫"]) assert(namedButton(tree, `智能灯泡设为${color}`));
    await namedButton(tree,"智能灯泡设为红").props.onClick();
    assert.deepEqual(JSON.parse(JSON.stringify(app.calls)), [{ action:"turn_on", params:{ [parameter]:[255, 0, 0, ...whiteChannels] } }]);
    tree = app.render();
    nodes(tree).find(node => node.type === "button" && text(node) === "自定义").props.onClick();
    tree = app.render();
    nodes(tree).find(node => node.type === "input" && node.props.type === "color").props.onChange({ target:{ value:"#123456" } });
    tree = app.render();
    await nodes(tree).find(node => node.type === "button" && text(node) === "应用颜色").props.onClick();
    assert.deepEqual(JSON.parse(JSON.stringify(app.calls[1])), { action:"turn_on", params:{ [parameter]:[18, 52, 86, ...whiteChannels] } });
  });
}

test("white-only lights retain white control without offering unsupported colors", () => {
  const tree = setup("white").render();
  assert(namedButton(tree,"智能灯泡白光"));
  assert.equal(namedButton(tree,"智能灯泡设为红"),undefined);
  assert.doesNotMatch(text(tree),/自定义/);
});

test("an off RGBW light keeps the full palette visible with controls disabled", () => {
  const tree = setup("rgbw_color","off").render();
  const swatches = nodes(tree).filter(node => node.type === "button" && node.props.className === "colorSwatch");
  assert.equal(swatches.length,8);
  assert(swatches.every(node => node.props.disabled));
});
