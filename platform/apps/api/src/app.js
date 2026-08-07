import express from "express";
import cors from "cors";
import { resolveCorsOrigin } from "./config.js";
import { securityHeaders } from "./middleware/headers.js";
import routes from "./routes/index.js";

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(cors({ origin: resolveCorsOrigin(), credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(securityHeaders);

app.use("/", routes);

export default app;
