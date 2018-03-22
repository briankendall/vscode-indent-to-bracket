'use strict';
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Activated: indent-to-bracket');
    
    overrideCommand(context, "type", async args => {
        if (args.text === "\n" || args.text == "\r\n") {
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

interface IObjectWithStringValues { [key: string]: string; }
interface IObjectWithNumericValues { [key: string]: number; }

class BracketCounter {
    private static get kBracketKeys(): IObjectWithStringValues {
        return {'(': 'paren', ')': 'paren', '[': 'square',']': 'square',
                '{': 'curly', '}': 'curly', '<': 'angle', '>': 'angle'};
    }
    tallies: IObjectWithNumericValues = {paren: 0, square: 0, curly: 0, angle: 0};
    
    private static keyForBracket(bracket: string) {
        return this.kBracketKeys[bracket];
    }
    
    public addToTallyForBracket(bracket: string, amount: number) {
        this.tallies[BracketCounter.keyForBracket(bracket)] += amount;
    }
    
    public bracketTallyForBracket(bracket: string) {
        return this.tallies[BracketCounter.keyForBracket(bracket)];
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
    
function isClosingBracket(bracket: string) {
    return bracket === ')' || bracket === ']' || bracket === '}' || bracket == '>';
}

function doesLineEndWithOpenBracket(line: string) {
    var regex = /(\(|\[|{)\s*$/g;
    return line.search(regex) !== -1;
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

function columnOfCharacterInLine(line: string, character: number, tabSize: number) {
    var result = 0;
    
    for(var i = 0; i < character; ++i) {
        if (line[i] == '\t') {
            result += tabSize;
        } else {
            result += 1;
        }
    }
    
    return result;
}

// Returns null if the given line doesn't indicate the point we want to indent to
function findIndentationPositionInLineAndTallyOpenBrackets(line: string, tallies: BracketCounter, tabSize: number) : number | null {
    var indices = allBracketsInString(line);
    
    if (indices.length === 0) {
        return null;
    }
    
    for(var i = indices.length-1; i >= 0; --i) {
        var index = indices[i];
        var char: string = line[index];
        
        if (isClosingBracket(char)) {
            tallies.addToTallyForBracket(char, 1);
        } else if (tallies.bracketTallyForBracket(char) == 0) {
            // An open bracket that has no matching closing bracket -- we want to indent to the column after it!
            return columnOfCharacterInLine(line, index, tabSize)+1;
        } else {
            tallies.addToTallyForBracket(char, -1);
        }
    }
    
    return null;
}
 
function findIndentationPositionOfPreviousOpenBracket(editor: vscode.TextEditor, position: vscode.Position) : number | null {
    var document = editor.document;
    var startingLineNumber = position.line;
    // Don't want to consider the entire line if the insertion point isn't at the end:
    var startingLine = document.lineAt(startingLineNumber).text.substring(0, position.character);
    var tabSize = editor.options.tabSize as number;
    
    if (doesLineEndWithOpenBracket(startingLine)) {
        // We want to use the editor's default indentation in this case
        return null;
    }
    
    var tallies = new BracketCounter();
    
    for(var currentLineNumber = startingLineNumber; currentLineNumber >= 0; --currentLineNumber) {
        var currentLine = (currentLineNumber === startingLineNumber) ? startingLine : document.lineAt(currentLineNumber).text;
        var indentationIndex = findIndentationPositionInLineAndTallyOpenBrackets(currentLine, tallies, tabSize);
        
        if (indentationIndex !== null) {
            return indentationIndex;
        }
        
        if (tallies.areAllBracketsClosed()) {
            if (currentLineNumber !== startingLineNumber) {
                return columnOfCharacterInLine(currentLine, document.lineAt(currentLineNumber).firstNonWhitespaceCharacterIndex,
                                               tabSize);
            } else {
                return null;
            }
        }
    }
    
    return null;
}

function indentationWhitespaceToColumn(column: number, tabSize: number, insertSpaces: boolean) {
    if (insertSpaces) {
        return ' '.repeat(column);
    } else {
        return '\t'.repeat(column / tabSize) + ' '.repeat(column % tabSize);
    }
}

// Since TextEditor.edit returns a thenable but not a promise, this is a convenience function that calls
// TextEditor.edit and returns a proper promise, allowing for chaining
function editorEdit(editor: vscode.TextEditor, callback: (editBuilder: vscode.TextEditorEdit) => void,
                    options?: {undoStopAfter: boolean, undoStopBefore: boolean}) {
    return new Promise<boolean>((resolve, reject) => {
        editor.edit(callback, options).then((success: boolean) => {
            if (success) {
                resolve(true);
            } else {
                reject();
            }
        });
    });
}

function performInsertEditWithWorkingRedo(editor: vscode.TextEditor, position: vscode.Position, text: string) {
    // When VS Code executes an edit using TextEditor.edit, the undo stop it creates places the insertion
    // point not at the position it moved to after the edit, but the position it was at before the edit.
    // This means that if the user does an undo followed by a redo after our call to TextEditor.edit, the
    // insertion point will be in the wrong place -- before the newline the user just typed! We work around
    // this by executing two calls to TextEditor.edit. The first inserts the text we want and creates only one
    // undo stop before the edit -- but not after. Then we execute a second edit that inserts an empty string
    // after the text we inserted with the first edit, with no undo stop created before the edit but one
    // created after. Consequently, only one undoable action is effectively created, but when the user
    // performs an undo followed by a redo, the text cursor is placed after the text we inserted.
    return new Promise<boolean>(async (resolve, reject) => {
        editorEdit(editor, (edit: vscode.TextEditorEdit) => {
            edit.insert(position, text);
        }, { undoStopBefore: true, undoStopAfter: false }).catch(() => {
            // If the first edit goes wrong, we want to reject the promise so that we'll fall back on the
            // VS Code's default behavhior.
            console.log('indent-to-bracket error: edit failed!');
            reject();
        }).then(() => {
            return editorEdit(editor, (edit: vscode.TextEditorEdit) => {
                edit.insert(editor!.selection.active, '');
            }, { undoStopBefore: false, undoStopAfter: true })
        }).then(() => {
            resolve();
        }).catch(() => {
            // If the second edit goes wrong, we've already inserted text so we definitely *don't* want
            // VS Code's default behavior any longer -- we'd get two newlines. All we can do is toss
            // out a warning message and hope the user doesn't get confused by the funky undo behavior.
            console.log('indent-to-bracket error: second edit during newline failed, undo/redo may not work correctly!');
            resolve();
        });
    });
}

async function maybeInsertNewLineAndIndent() {
    let editor = vscode.window.activeTextEditor;
    
    if (editor === undefined) {
        return Promise.reject(null);
    }
    
    let indentationPosition = findIndentationPositionOfPreviousOpenBracket(editor!, editor!.selection.active);
    
    if (indentationPosition === null) {
        return Promise.reject(null);
    }
    
    var whitespace = indentationWhitespaceToColumn(indentationPosition, editor.options.tabSize as number,
                                                   editor.options.insertSpaces as boolean);
    await performInsertEditWithWorkingRedo(editor!, editor!.selection.active, '\n' + whitespace);
}

// this method is called when your extension is deactivated
export function deactivate() {
}
