import { createHandler } from "../server/handler.mjs";

export default createHandler(process.env.KISTI_DB || "/tmp/kisti-book.json");
