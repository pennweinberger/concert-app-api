import Fastify from "fastify";
import cors from "@fastify/cors";
import dotenv from "dotenv";
import artistsRoutes from "./routes/artists";
import showsRoutes from "./routes/shows";
import reviewsRoutes from "./routes/reviews";

dotenv.config();

const app = Fastify({ logger: true });

app.register(cors, {
  origin: true,
});

app.register(artistsRoutes);
app.register(showsRoutes);
app.register(reviewsRoutes);

app.get("/health", async () => {
  return { ok: true };
});

const start = async () => {
  try {
    await app.listen({ port: 3001, host: "0.0.0.0" });
    console.log("Server running on http://localhost:3001");
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
