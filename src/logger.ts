import * as vscode from 'vscode';

export class Logger {
    private static channel: vscode.OutputChannel;

    public static initialize(context: vscode.ExtensionContext, existingChannel?: vscode.OutputChannel) {
        if (!Logger.channel) {
            Logger.channel = arguments.length > 1 ? arguments[1] : vscode.window.createOutputChannel('Shumilek');
        }
    }

    private static log(level: string, message: string) {
        if (!Logger.channel) return;
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
        Logger.channel.appendLine(`[${timestamp}] [${level}] ${message}`);
    }

    public static info(message: string) {
        Logger.log('INFO', message);
    }

    public static debug(message: string) {
        Logger.log('DEBUG', message);
    }

    public static warn(message: string) {
        Logger.log('WARN', message);
    }

    public static error(message: string, error?: any) {
        let fullMessage = message;
        if (error) {
            fullMessage += ' - ' + (error instanceof Error ? error.message : String(error));
        }
        Logger.log('ERROR', fullMessage);
    }
}
