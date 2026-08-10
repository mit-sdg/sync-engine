import { assembleApplication } from "./assembly.ts";

const application = assembleApplication();
console.log(JSON.stringify(Object.keys(application.publicInterface.routes).sort()));
