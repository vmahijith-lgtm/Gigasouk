import Image from "next/image";

type BrandLogoProps = {
  width?: number;
  height?: number;
  alt?: string;
};

export default function BrandLogo({
  width = 106,
  height = 26,
  alt = "GigaSouk",
}: BrandLogoProps) {
  return (
    <Image
      src="/brand/logo.png"
      alt={alt}
      width={width}
      height={height}
      priority
      style={{ height: "auto", width: "auto", maxWidth: "100%", background: "transparent", display: "block" }}
    />
  );
}
