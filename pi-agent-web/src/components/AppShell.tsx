import { useState } from "react";
import { useTheme } from "../hooks/useTheme";
import { ChatInput } from "./ChatInput";
import { ChatWindow } from "./ChatWindow";
import { KnowledgePanel } from "./KnowledgePanel";
import { ProvidersPanel } from "./ProvidersPanel";
import { SettingsPanel } from "./SettingsPanel";
import { Sidebar } from "./Sidebar";
import { SkillsPanel } from "./SkillsPanel";
import { TopBar } from "./TopBar";

export function AppShell() {
	const { theme, toggle, setTheme } = useTheme();
	const [mobileOpen, setMobileOpen] = useState(false);
	const [providersOpen, setProvidersOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [skillsOpen, setSkillsOpen] = useState(false);
	const [knowledgeOpen, setKnowledgeOpen] = useState(false);

	const sidebar = (
		<Sidebar
			onOpenProviders={() => {
				setProvidersOpen(true);
				setMobileOpen(false);
			}}
			onOpenSkills={() => {
				setSkillsOpen(true);
				setMobileOpen(false);
			}}
			onOpenKnowledge={() => {
				setKnowledgeOpen(true);
				setMobileOpen(false);
			}}
			onClose={() => setMobileOpen(false)}
		/>
	);

	return (
		<div className="flex h-full w-full overflow-hidden bg-bg text-text">
			<div className="hidden md:flex">{sidebar}</div>

			{mobileOpen && (
				<div className="fixed inset-0 z-40 flex md:hidden">
					<div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
					<div className="relative z-10 h-full">{sidebar}</div>
				</div>
			)}

			<main className="flex min-w-0 flex-1 flex-col">
				<TopBar
					theme={theme}
					onToggleTheme={toggle}
					onOpenSettings={() => setSettingsOpen(true)}
					onToggleSidebar={() => setMobileOpen((v) => !v)}
				/>
				<ChatWindow />
				<ChatInput />
			</main>

		<ProvidersPanel open={providersOpen} onClose={() => setProvidersOpen(false)} />
		<SkillsPanel open={skillsOpen} onClose={() => setSkillsOpen(false)} />
		<KnowledgePanel open={knowledgeOpen} onClose={() => setKnowledgeOpen(false)} />
		<SettingsPanel
				open={settingsOpen}
				onClose={() => setSettingsOpen(false)}
				theme={theme}
				setTheme={setTheme}
			/>
		</div>
	);
}
