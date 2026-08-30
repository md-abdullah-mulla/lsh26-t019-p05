import path from "node:path";
import { createHandler } from "../server/handler.mjs";

const persist = process.env.KISTI_DB || "/tmp/kisti-book.json";
const handler = createHandler(persist);

export default handler;
