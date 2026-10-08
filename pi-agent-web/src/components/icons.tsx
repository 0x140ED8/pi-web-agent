import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...props }: IconProps) {
	return {
		width: size,
		height: size,
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 1.9,
		strokeLinecap: "round" as const,
		strokeLinejoin: "round" as const,
		...props,
	};
}

export const PlusIcon = (p: IconProps) => (
	<svg {...base(p)}>
		<path d="M12 5v14M5 12h14" />
	</svg>
);

export const RefreshIcon = (p: IconProps) => (
	<svg {...base(p)}>
		<path d="M21 12a9 9 0 1 1-2.64-6.36" />
		<path d="M21 3v6h-6" />
	</svg>
);

export const TrashIcon = (p: IconProps) => (
	<svg {...base(p)}>
		<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
	</svg>
);

export const PencilIcon = (p: IconProps) => (
	<svg {...base(p)}>
		<path d="M12 20h9" />
		<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
	</svg>
);

export const GearIcon = (p: IconProps) => (
	<svg {...base(p)}>
		<circle cx="12" cy="12" r="3" />
		<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
	</svg>
);

export const SunIcon = (p: IconProps) => (
	<svg {...base(p)}>
		<circle cx="12" cy="12" r="4" />
		<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
	</svg>
);

export const MoonIcon = (p: IconProps) => (
	<svg {...base(p)}>
		<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
	</svg>
);

export const SendIcon = (p: IconProps) => (
	<svg {...base(p)}>
		<path d="M22 2 11 13" />
		<path d="M22 2 15 22l-4-9-9-4Z" />
	</svg>
);

export const StopIcon = (p: IconProps) => (
	<svg {...base(p)}>
		<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
	</svg>
);

export const ChevronIcon = (p: IconProps) => (
	<svg {...base(p)}>
		<path d="m9 18 6-6-6-6" />
	</svg>
);

export const CloseIcon = (p: IconProps) => (
	<svg {...base(p)}>
		<path d="M18 6 6 18M6 6l12 12" />
	</svg>
);

export const CopyIcon = (p: IconProps) => (
	<svg {...base(p)}>
		<rect x="9" y="9" width="11" height="11" rx="2" />
		<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
	</svg>
);

export const CheckIcon = (p: IconProps) => (
	<svg {...base(p)}>
		<path d="M20 6 9 17l-5-5" />
	</svg>
);

export const CpuIcon = (p: IconProps) => (
	<svg {...base(p)}>
		<rect x="4" y="4" width="16" height="16" rx="2" />
		<rect x="9" y="9" width="6" height="6" rx="1" />
		<path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" />
	</svg>
);

export const SparkIcon = (p: IconProps) => (
	<svg {...base(p)}>
		<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
	</svg>
);

export const WrenchIcon = (p: IconProps) => (
	<svg {...base(p)}>
		<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-2.4Z" />
	</svg>
);

export const PanelIcon = (p: IconProps) => (
	<svg {...base(p)}>
		<rect x="3" y="4" width="18" height="16" rx="2" />
		<path d="M9 4v16" />
	</svg>
);

export const CompactIcon = (p: IconProps) => (
	<svg {...base(p)}>
		<path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3" />
		<path d="M8 12h8" />
	</svg>
);

export const LayersIcon = (p: IconProps) => (
	<svg {...base(p)}>
		<path d="m12 2 -10 5 10 5 10-5-10-5Z" />
		<path d="m2 12 10 5 10-5M2 17l10 5 10-5" />
	</svg>
);

export const DatabaseIcon = (p: IconProps) => (
	<svg {...base(p)}>
		<ellipse cx="12" cy="5" rx="8" ry="3" />
		<path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
		<path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
	</svg>
);
