'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "indenttobracket" is now active!');
    
    overrideCommand(context, "type", async args => {
        if (args.text === "\n") {
            console.log('Enter key!');
            maybeInsertNewLineAndIndent().catch(async () => {
                await vscode.commands.executeCommand('default:type', args);
            })
        } else {
            await vscode.commands.executeCommand('default:type', args);
        }
    });
}

// Method borrowed from vim vscode extension
function overrideCommand(context: vscode.ExtensionContext, command: string, callback: (...args: any[]) => any) {
    const disposable = vscode.commands.registerCommand(command, async args => {
        // TODO: add way of disabling extension
        if (!vscode.window.activeTextEditor) {
            await vscode.commands.executeCommand('default:' + command, args);
            return;
        }

        // Not precisely sure why this is important, but if the vim folk think that the behavior of this document
        // should remained unmodified, perhaps I should follow suit!
        if (vscode.window.activeTextEditor.document && vscode.window.activeTextEditor.document.uri.toString() === 'debug:input') {
            await vscode.commands.executeCommand('default:' + command, args);
            return;
        }

        callback(args);
    });
    
    context.subscriptions.push(disposable);
}

function allBracketsInString(s: string) {
    var regex = /(\(|\)|\[|\]|{|})/g;
    var indices = new Array();
    var match = null;
    
    while(match = regex.exec(s)) {
        indices.push(match.index);
    }
    
    return indices;
}

function lineEndsWithOpenBracket(line: string) {
    var regex = /(\(|\[|{)\s*$/g;
    return line.search(regex) !== -1;
}

interface IObjectWithStringValues { [key: string]: string; }
interface IObjectWithNumericValues { [key: string]: number; }

class BracketTally {
    private static get kBracketKeys(): IObjectWithStringValues { return {'(': 'paren', ')': 'paren', '[': 'square', ']': 'square', '{': 'curly', '}': 'curly', '<': 'angle', '>': 'angle'}; }
    tallies: IObjectWithNumericValues = {paren: 0, square: 0, curly: 0, angle: 0};
    
    private static keyForBracket(bracket: string) {
        return this.kBracketKeys[bracket];
    }
    
    public static isClosingBracket(bracket: string) {
        return bracket === ')' || bracket === ']' || bracket === '}' || bracket == '>';
    }
    
    public addToTallyForBracket(bracket: string, amount: number) {
        this.tallies[BracketTally.keyForBracket(bracket)] += amount;
    }
    
    public bracketTallyForBracket(bracket: string) {
        return this.tallies[BracketTally.keyForBracket(bracket)];
    }
    
    public areAllBracketsClosed() {
        for(var key in this.tallies) {
            if (this.tallies.hasOwnProperty(key) && this.tallies[key] !== 0) {
                return false;
            }
        }
        
        return true;
    }
}

// Returns null if the given line doesn't indicate the point we want to indent to
function findIndentationPositionInLineAndKeepTallyOfBrackets(line: string, tallies: BracketTally) {
    var indices = allBracketsInString(line);
    
    if (indices.length === 0) {
        return null;
    }
    
    for(var i = indices.length-1; i >= 0; --i) {
        var index = indices[i];
        var char: string = line[index];
        
        if (BracketTally.isClosingBracket(char)) {
            tallies.addToTallyForBracket(char, 1);
        } else if (tallies.bracketTallyForBracket(char) == 0) {
            // An opening bracket that has no matching closing bracket -- we want to indent to the column after it!
            return index+1;
        } else {
            tallies.addToTallyForBracket(char, -1);
        }
    }
    
    return null;
}

function findIndentationPosition(document: vscode.TextDocument, lastLineNumber: number) {
    var lastLine = document.lineAt(lastLineNumber).text;
    
    if (lineEndsWithOpenBracket(lastLine)) {
        // We want to use the editor's default indentation in this case
        return null;
    }
    
    var tallies = new BracketTally();
    
    for(var currentLineNumber = lastLineNumber; currentLineNumber >= 0; --currentLineNumber) {
        var currentLine = document.lineAt(currentLineNumber).text;
        var indentationIndex = findIndentationPositionInLineAndKeepTallyOfBrackets(currentLine, tallies);
        
        if (indentationIndex !== null) {
            //console.log("  found indentation index: " + indentationIndex);
            return indentationIndex;
        }
        
        if (tallies.areAllBracketsClosed()) {
            //console.log("  all brackets closed");
            if (currentLineNumber !== lastLineNumber) {
                return document.lineAt(currentLineNumber).firstNonWhitespaceCharacterIndex;
            } else {
                return null;
            }
        }
    }
    
    return null;
}

async function maybeInsertNewLineAndIndent() {
    return new Promise<boolean>(async (resolve, reject) => {
        let editor = vscode.window.activeTextEditor;
        
        if (editor === undefined) {
            reject();
            return;
        }
        
        let document = editor!.document;
        let position = editor!.selection.active;
        let indentationPosition = findIndentationPosition(document, position.line);
        console.log("indenting to: " + indentationPosition);
        
        if (indentationPosition === null) {
            reject();
            return;
        }
        
        // TODO: support tabs as well as spaces
        
        editor!.edit(function (edit: vscode.TextEditorEdit): void {
            edit.insert(position, '\n' + ' '.repeat(indentationPosition));
        }).then((success: boolean) => {
            if (success) {
                resolve();
            } else {
                console.log('indent-to-bracket error: edit failed!');
                reject();
            }
        });
    });
}

// this method is called when your extension is deactivated
export function deactivate() {
}
