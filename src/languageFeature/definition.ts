import { ExtensionContext, languages, Position, TextDocument } from "vscode";
import { shortLive } from "./hover";

export function registerDefinition(context: ExtensionContext, _canLanguages: string[] = []) {
    const definitionProviderDisposable = languages.registerDefinitionProvider(
        '*',
        {
            provideDefinition: (document: TextDocument, position: Position) => {
                shortLive.add({
                    uri: document.uri.toString(),
                    line: position.line
                });
                return null;
            }
        }
    );

    context.subscriptions.push(definitionProviderDisposable);
}
