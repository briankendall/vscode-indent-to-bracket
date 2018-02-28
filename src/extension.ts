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

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable = vscode.commands.registerCommand('extension.sayHello', () => {
        // The code you place here will be executed every time your command is executed
        console.log('Wut wut!');
        // Display a message box to the user
        vscode.window.showInformationMessage('Hello World!');
    });

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(
            changeEvent => { activateOnEnter(changeEvent) }
        )
    );

    context.subscriptions.push(disposable);
}

function activateOnEnter(changeEvent: vscode.TextDocumentChangeEvent) {
    if (vscode.window === undefined || vscode.window.activeTextEditor === undefined) {
        return;
    }

    if (vscode.window.activeTextEditor.document !== changeEvent.document || changeEvent.contentChanges[0].rangeLength !== 0) {
        return;
    }

    if (changeEvent.contentChanges[0].text.replace(/ |\t|\r/g, "") === "\n") {
        console.log('\n\nEnter press!!');
        onEnterPress(changeEvent);
    }
}

function positionToString(p: vscode.Position) {
    return ("(l: " + p.line + " c: " + p.character + ")");
}

function rangeToString(r: vscode.Range) {
    return ("start: " + positionToString(r.start) + " end: " + positionToString(r.end));
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

/*

    blah = asdf()
    wut(asdf, asdf, (thingy,
                     foo = asdfdfd(123, 45, {1, 2, 3,
                                             [4, 5, 6,
                                              (hi there),
                                              5],
                                             'asdfasdf'}),
                     bloo))
    wut(asdf, asdf, (thingy,
                     foo = asdfdfd(123, 45, {1, 2, 3,
                                             [4, 5, 6,
                                              (hi there,
                                               asdf,
                                               asdf,
                                               asdfd),
                                              1232,
                                              334]},
                                   asdfasdf)
                     asdfasdf,
                     asdfasdfasdf))
                                


*/

interface IObjectWithStringKey { [key: string]: string; }
interface IObjectWithIntKey { [key: string]: number; }
const bracketKeys: IObjectWithStringKey = {'(': 'paren', ')': 'paren', '[': 'square', ']': 'square', '{': 'curly', '}': 'curly', '<': 'angle', '>': 'angle'};

function findIndentationPositionInLineAndKeepTallyOfBrackets(line: string, tallies: IObjectWithIntKey) {
    var indices = allBracketsInString(line);
    
    if (indices.length === 0) {
        return null;
    }
    
    for(var i = indices.length-1; i >= 0; --i) {
        var index = indices[i];
        var char: string = line[index];
        var key = bracketKeys[char];
        
        if (char === ')' || char === ']' || char === '}' || char == '>') {
            tallies[key] += 1;
        } else if (tallies[key] == 0) {
            return index+1;
        } else {
            tallies[key] -= 1;
        }
    }
    
    return null;
}

function bracketTalliesIndicateAllBracketsClosed(tallies: IObjectWithIntKey) {
    for(var key in tallies) {
        if (tallies.hasOwnProperty(key)) {
            //console.log('bracketTalliesIndicateAllBracketsClosed key: ' + key);
            
            if (tallies[key] !== 0) {
                return false;
            }
        }
    }
    
    return true;
}

function indentationLevelOfLine(line: string) {
    var regex = /(\(|\[|{)\s*$/g;
    return line.search(regex) !== -1;
}

function findIndentationPosition(document: vscode.TextDocument, lastLineNumber: number) {
    var lastLine = document.lineAt(lastLineNumber).text;
    
    if (lineEndsWithOpenBracket(lastLine)) {
        // We want to use the editor's default indentation in this case
        return null;
    }
    
    var tallies: IObjectWithIntKey = {paren: 0, square: 0, curly: 0, angle: 0};
    
    for(var currentLineNumber = lastLineNumber; currentLineNumber >= 0; --currentLineNumber) {
        var currentLine = document.lineAt(currentLineNumber).text;
        var indentationIndex = findIndentationPositionInLineAndKeepTallyOfBrackets(currentLine, tallies);
        console.log("Considering line " + currentLineNumber + " : " + currentLine);
        console.log("  tallies:");
        
        for(var key in tallies) {
            if (tallies.hasOwnProperty(key)) {
                console.log("    " + key + " : " + tallies[key]);
            }
        }
        
        if (indentationIndex !== null) {
            console.log("  found indentation index: " + indentationIndex);
            return indentationIndex;
        }
        
        if (bracketTalliesIndicateAllBracketsClosed(tallies)) {
            console.log("  all brackets closed");
            if (currentLineNumber !== lastLineNumber) {
                return document.lineAt(currentLineNumber).firstNonWhitespaceCharacterIndex;
            } else {
                return null;
            }
        }
    }
    
    return null;
}

function onEnterPress(changeEvent: vscode.TextDocumentChangeEvent) {
    let editor = vscode.window.activeTextEditor;

    if (editor === undefined) {
        return;
    }

    for(let i = 0; i < changeEvent.contentChanges.length; ++i) {
        //console.log("changes " + i + ": " + rangeToString(changeEvent.contentChanges[i].range) + "->" + rangeToString(changeEvent.contentChanges[i].range) + " : " + changeEvent.contentChanges[i].text.length);
        //console.log("change length: " + changeEvent.contentChanges[i].rangeLength);
    }

    let document = editor.document;
    let position = editor.selection.active;

    //console.log("position1: " + position.line + " " + position.character);
    setTimeout(maybeIndentToBracket, 0);
}

function maybeIndentToBracket() {
    let editor = vscode.window.activeTextEditor;
    
    if (editor === undefined) {
        return;
    }
    
    let document = editor.document;
    let position = editor.selection.active;
    
    //console.log("position2: " + position.line + " " + position.character);
    
    if (position.line === 0) {
        return;
    }
    
    let prevLine = document.lineAt(position.line-1);
    let indentationPosition = findIndentationPosition(document, position.line-1);
    console.log("indent to: " + indentationPosition);
    
    if (indentationPosition === null) {
        return;
    }
    
    var spacesToInsert = indentationPosition - position.character;
    
    if (spacesToInsert > 0) {
        editor.insertSnippet(new vscode.SnippetString(' '.repeat(spacesToInsert)), position);
    } else {
        editor.edit(function (edit: vscode.TextEditorEdit): void {
            edit.delete(new vscode.Range(new vscode.Position(position.line, indentationPosition), position));
        }).then(success => {
            console.log("deletion edit success: " + success);
        });
    }
    
    
    
}

// this method is called when your extension is deactivated
export function deactivate() {
}