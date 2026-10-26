import Image from "next/image";

// The logo is drawn with a transparent ground, so it sits on whatever surface
// it is placed on. Its ink must change with the theme (dark ink on light, light
// ink on dark), so there are two files and the page's theme chooses between
// them. That theme is the reader's choice, or the system's when there is none
// (see ThemeSwitch), and the same `dark:` variant drives the rest of the app.

// The file names carry a version: Next.js caches optimised images by URL, so an
// edited file under the same name keeps serving its old pixels.
const LIGHT = { src: "/brand/anamnesis-lockup-light.png", width: 1870, height: 672 };
const DARK = { src: "/brand/anamnesis-lockup-dark-v2.png", width: 1870, height: 672 };

/**
 * The mark and wordmark. `height` sets the size; the width follows the logo.
 * Every place it appears (sidebar, phone header, sign-in) is above the fold, so
 * both files load eagerly. Lazy loading would make the browser report the logo
 * as the page's largest contentful paint and ask for `loading="eager"`.
 */
export function BrandLockup({ height = 36 }: { height?: number }) {
  const width = (asset: typeof LIGHT) => Math.round((height * asset.width) / asset.height);

  return (
    <span role="img" aria-label="Anamnesis" className="inline-block align-middle">
      <Image
        src={LIGHT.src}
        alt=""
        width={width(LIGHT)}
        height={height}
        priority
        className="block dark:hidden"
      />
      <Image
        src={DARK.src}
        alt=""
        width={width(DARK)}
        height={height}
        priority
        className="hidden dark:block"
      />
    </span>
  );
}
