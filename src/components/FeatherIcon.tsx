import feather from "feather-icons";
import type { MouseEventHandler } from "react";

const customIconContents: Record<string, string> = {
  robot:
    '<rect x="5" y="7" width="14" height="12" rx="3"></rect><path d="M12 3v4"></path><circle cx="9" cy="12" r="1"></circle><circle cx="15" cy="12" r="1"></circle><path d="M9 16h6"></path><path d="M5 11H3v4h2"></path><path d="M19 11h2v4h-2"></path>',
};

export function FeatherIcon({
  icon,
  size = 24,
  onClick,
}: {
  icon: string;
  size?: number | string;
  onClick?: MouseEventHandler<SVGSVGElement>;
}) {
  const definition = feather.icons[icon as keyof typeof feather.icons];
  const contents = definition?.contents || customIconContents[icon];
  if (!contents) return null;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      data-icon={icon}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      pointerEvents={onClick ? "auto" : "none"}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: contents }}
    />
  );
}
