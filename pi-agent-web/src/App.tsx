import { AppShell } from "./components/AppShell";
import { I18nProvider } from "./i18n";
import { AgentProvider } from "./state/agent";

export default function App() {
	return (
		<I18nProvider>
			<AgentProvider>
				<AppShell />
			</AgentProvider>
		</I18nProvider>
	);
}
