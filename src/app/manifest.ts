import type { MetadataRoute } from "next";

/**
 * Makes Anamnesis installable on a phone. Deliberately no service worker: every
 * page here is server-rendered from the database, so an offline shell would
 * only ever show an empty frame — it would add a caching layer to maintain in
 * exchange for nothing the user can actually read.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Anamnesis",
    short_name: "Anamnesis",
    description: "An AI-native personal knowledge and productivity workspace.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f6f8",
    theme_color: "#f5f6f8",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
