import Image from "next/image";

/** Single source of truth — matches the compact landing navbar footprint (~52px). */
export const BRAND_LOGO_WIDTH = 52;
export const BRAND_LOGO_HEIGHT = 52;

type BrandLogoProps = {
  width?: number;
  height?: number;
  alt?: string;
};

export default function BrandLogo({
  width = BRAND_LOGO_WIDTH,
  height = BRAND_LOGO_HEIGHT,
  alt = "GigaSouk",
}: BrandLogoProps) {
  return (
    <Image
      src="/brand/logo.png"
      alt={alt}
      width={width}
      height={height}
      priority
      style={{
        width,
        height,
        objectFit: "contain",
        background: "transparent",
        display: "block",
      }}
    />
  );
}
