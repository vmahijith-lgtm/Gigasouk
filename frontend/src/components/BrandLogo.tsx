import Image from "next/image";

type BrandLogoProps = {
  width?: number;
  height?: number;
  alt?: string;
};

export default function BrandLogo({
  width = 126,
  height = 32,
  alt = "GigaSouk",
}: BrandLogoProps) {
  return (
    <Image
      src="/brand/logo.png"
      alt={alt}
      width={width}
      height={height}
      priority
      style={{ height: "auto", width: "auto", maxWidth: "100%" }}
    />
  );
}
