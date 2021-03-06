import { EventEmitter, TreeItem, Event, TreeItemCollapsibleState, Uri, TextDocumentContentProvider, CancellationToken, ProviderResult, TreeView } from 'vscode';
import * as vscode from 'vscode';
import * as path from 'path';
import * as moment from 'moment';

import { TreeDataProvider } from 'vscode';
const k8s = require('@kubernetes/client-node');

interface ModelNode {
    readonly resource: vscode.Uri;
    readonly isDirectory: boolean;
    readonly label: string;
    readonly title: string;
    readonly contextValue: string;
    readonly tooltip: string;
    readonly iconPath: string;
    readonly commandName: string;

    getChildren(): ModelNode[];

    parent(): ModelNode;
}

export class StageNode implements ModelNode {
    constructor(public resource: vscode.Uri, public build: BuildNode, public name: string, readonly pipeline: any, readonly step: any, readonly contextValue: string, readonly url?: string) {
    }

    getChildren(): ModelNode[] {
        return [];
    }

    parent(): ModelNode {
        return this.build;
    }

    get isDirectory(): boolean {
        return false;
    }

    get title(): string {
        return "Stage";
    }

    get label(): string {
        return this.name;
    }

    get commandName(): string {
        /*
        // TODO wonder if we could only enable these commands if folks double click on the node rather than on selection?

        switch (this.contextValue) {
            case "vsJenkinsX.pipelines.stage.app":
                return "PipelineExplorer.openEnvironmentApplication";
            case "vsJenkinsX.pipelines.stage.pullRequest":
                return "PipelineExplorer.openPullRequest";
            case "vsJenkinsX.pipelines.stage.update":
                return "PipelineExplorer.openUpdate";
        }
        */
        return "";
    }

    get iconPath(): string {
        switch (this.status) {
            case "Succeeded":
                return "images/atomist_build_passed.png";
            case "Failed":
            case "Error":
                return "images/atomist_build_failed.png";
            case "Running":
                return "images/spinner.gif";
            case "Aborted":
                return "images/circle-64.png";
            case "NotExecuted":
                // TODO
                return "";
        }
        return "";
    }

    get tooltip(): string {
        let step = this.step || {};
        return this.name + ": " + this.status + elapsedTime(" Duration: ", step.startedTimestamp, step.completedTimestamp);
    }

    get status(): string {
        let step = this.step || {};
        return step.status || "Unknown";
    }

}


export class BuildNode implements ModelNode {
    private _pipeline: any = null;
    private _children: StageNode[] = [];

    constructor(public resource: vscode.Uri, public repo: RepoNode, public buildNumber: string) {
    }

    getChildren(): ModelNode[] {
        let answer: ModelNode[] = [];
        this._children.forEach(value => answer.push(value));
        return answer;
    }

    parent(): ModelNode {
        return this.repo;
    }

    get isDirectory(): boolean {
        return true;
    }

    get title(): string {
        return "Build";
    }

    get label(): string {
        return this.buildNumber;
    }

    get commandName(): string {
        return "";
    }

    get iconPath(): string {
        switch (this.status) {
            case "Succeeded":
                return "images/atomist_build_passed.png";
            case "Failed":
            case "Error":
                return "images/atomist_build_failed.png";
            case "Running":
                return "images/spinner.gif";
            case "Aborted":
                return "images/circle-64.png";
        }
        return "";
    }

    get tooltip(): string {
        let step = this.pipelineSpec;
        return "#" + this.buildNumber + ": " + this.status + elapsedTime(" Duration: ", step.startedTimestamp, step.completedTimestamp);
    }

    get pipeline(): any {
        return this._pipeline;
    }

    set pipeline(that: any) {
        this._pipeline = that;

        // lets create the children 
        this._children = [];

        let spec = this.pipelineSpec;
        let steps = spec.steps;
        if (steps) {
            for (const step of steps) {
                if (step) {
                    var subStep = step;
                    let stage = step.stage;
                    let promote = step.promote;
                    var name = "";
                    if (stage) {
                        subStep = stage;
                        name = stage.name;
                        this._children.push(new StageNode(addChildUrl(this.resource, name), this, name, this.pipeline, subStep, "vsJenkinsX.pipelines.stage", ""));
                    }
                    if (promote) {
                        subStep = promote;
                        let envName: string = stringCapitalise(promote.environment);
                        name = "Promote to " + envName + "";

                        let appUrl = promote.applicationURL;
                        const stageContextValue = appUrl ? "vsJenkinsX.pipelines.stage.app" : "vsJenkinsX.pipelines.stage";
                        this._children.push(new StageNode(addChildUrl(this.resource, name), this, name, this.pipeline, subStep, stageContextValue, appUrl));
                        let pullRequest = subStep.pullRequest;
                        if (pullRequest) {
                            var pullRequestName = name + " Pull Request";
                            let prUrl: string = pullRequest.pullRequestURL || "";
                            if (prUrl) {
                                let idx = prUrl.lastIndexOf("/");
                                if (idx > 0) {
                                    pullRequestName += " #" + prUrl.substring(idx + 1);
                                }
                            }
                            this._children.push(new StageNode(addChildUrl(this.resource, name), this, pullRequestName, this.pipeline, pullRequest, "vsJenkinsX.pipelines.stage.pullRequest", prUrl));
                        }
                        let update = subStep.update;
                        if (update) {
                            var updatetName = name + " Update";
                            let statuses = update.statuses;
                            var updateUrl = "";
                            for (const status of statuses) {
                                updateUrl = status.url;
                                if (updateUrl) {
                                    break;
                                }
                            }
                            this._children.push(new StageNode(addChildUrl(this.resource, name), this, updatetName, this.pipeline, pullRequest, "vsJenkinsX.pipelines.stage.update", updateUrl));
                        }
                        if (appUrl) {
                            let appName = "App promoted to " + envName;
                            this._children.push(new StageNode(addChildUrl(this.resource, name), this, appName, this.pipeline, promote, "vsJenkinsX.pipelines.stage.app", appUrl));
                        }
                    }
                }
            }
        }
    }


    get status(): string {
        let status = "";
        let pipeline = this.pipeline;
        if (pipeline) {
            let spec = pipeline.spec;
            if (spec) {
                status = spec.status;
            }
        }
        status = status || "Unknown";
        return status;
    }

    get pipelineSpec(): any {
        let pipeline = this.pipeline;
        if (pipeline) {
            return pipeline.spec || {};
        }
        return {};
    }

    get buildLogsUrl(): string {
        return this.pipelineSpec.buildLogsUrl || "";
    }

    get buildUrl(): string {
        return this.pipelineSpec.buildUrl || "";
    }

    get gitUrl(): string {
        return this.pipelineSpec.gitUrl || "";
    }

    get pipelineName(): string {
        return this.pipelineSpec.pipeline || "";
    }

    get contextValue(): string {
        let suffix = this.status === "Running" ? ".Running" : "";
        if (this.buildLogsUrl && this.buildUrl && this.gitUrl) {
            return "vsJenkinsX.pipelines.build.hasUrls" + suffix;
        }
        return "vsJenkinsX.pipelines.build" + suffix;
    }
}


export class RepoNode implements ModelNode {
    private nodes: Map<string, BuildNode> = new Map<string, BuildNode>();

    constructor(public resource: vscode.Uri, public owner: OwnerNode, public repoName: string) {
    }

    isEmpty(): boolean {
        return this.nodes.size === 0;
    }

    get isDirectory(): boolean {
        return true;
    }

    get title(): string {
        return "Repository";
    }

    get label(): string {
        return this.repoName;
    }

    get tooltip(): string {
        return "Git Repository " + this.owner.folder + "/" + this.repoName;
    }

    get commandName(): string {
        return "";
    }

    get iconPath(): string {
        return "images/github.png";
    }

    get contextValue(): string {
        return "vsJenkinsX.pipelines.repo";
    }

    get pipelineName(): string {
        return this.owner.folder + "/" + this.repoName + "/master";
    }

    parent(): ModelNode {
        return this.owner;
    }

    getChildren(): ModelNode[] {
        let answer: BuildNode[] = [];
        this.nodes.forEach((value: BuildNode, key: string) => {
            answer.push(value);
        });
        answer.sort((n1, n2) => {
            if (n1.buildNumber && !n2.buildNumber) {
                return 1;
            }

            if (!n1.buildNumber && n2.buildNumber) {
                return -1;
            }
            return +n2.buildNumber - (+n1.buildNumber);
        });
        return answer;
    }


    upsertPipeline(buildNumber: string, pipeline: any) {
        if (buildNumber) {
            var build = this.nodes.get(buildNumber);
            if (!build) {
                build = new BuildNode(addChildUrl(this.resource, buildNumber), this, buildNumber);
                this.nodes.set(buildNumber, build);
            }
            build.pipeline = pipeline;
        }
    }

    deletePipeline(buildNumber: string, pipeline: any) {
        if (buildNumber) {
            this.nodes.delete(buildNumber);
        }
    }

}

/** Returns a relative URI */
function addChildUrl(uri: vscode.Uri, path: string): vscode.Uri {
    return uri.with({ path: uri.path + "/" + path });
}

export class OwnerNode implements ModelNode {
    private nodes: Map<string, RepoNode> = new Map<string, RepoNode>();

    constructor(public resource: vscode.Uri, public model: PipelineModel, public folder: string) {
    }

    isEmpty(): boolean {
        return this.nodes.size === 0;
    }

    get isDirectory(): boolean {
        return true;
    }

    get title(): string {
        return "Organisation";
    }

    get label(): string {
        return this.folder;
    }

    get tooltip(): string {
        return "Folder: " + this.folder;
    }

    get commandName(): string {
        return "";
    }

    get iconPath(): string {
        return "";
    }

    get contextValue(): string {
        return "vsJenkinsX.pipelines.owner";
    }

    parent(): ModelNode {
        return this.model;
    }

    getChildren(): ModelNode[] {
        return mapValuesInKeyOrder(this.nodes);
    }

    upsertPipeline(repoName: string, buildNumber: string, pipeline: any) {
        if (repoName) {
            var repo = this.nodes.get(repoName);
            if (!repo) {
                repo = new RepoNode(addChildUrl(this.resource, repoName), this, repoName);
                this.nodes.set(repoName, repo);
            }
            repo.upsertPipeline(buildNumber, pipeline);
        }
    }

    deletePipeline(repoName: string, buildNumber: string, pipeline: any) {
        if (repoName) {
            var repo = this.nodes.get(repoName);
            if (repo) {
                repo.deletePipeline(buildNumber, pipeline);
            }
        }
    }
}


export class PipelineModel implements ModelNode {

    private nodes: Map<string, OwnerNode> = new Map<string, OwnerNode>();
    private _onDidChangeTreeData: EventEmitter<any> = new EventEmitter<any>();

    readonly onDidChangeTreeData: Event<any> = this._onDidChangeTreeData.event;
    resource: vscode.Uri = Uri.parse("pipeline:localhost");

    getChildren(): ModelNode[] {
        return mapValuesInKeyOrder(this.nodes);
    }

    parent(): ModelNode {
        return this;
    }

    get isDirectory(): boolean {
        return true;
    }


    get title(): string {
        return "Pipelines";
    }

    get label(): string {
        return "Pipelines";
    }

    get tooltip(): string {
        return "Jenkins X Pipelines";
    }

    get commandName(): string {
        return "";
    }

    get iconPath(): string {
        return "";
    }

    get contextValue(): string {
        return "vsJenkinsX.pipelines";
    }

    getNodeChildren(element?: ModelNode): ModelNode[] {
        return element ? element.getChildren() : this.getChildren();
    }

    upsertPipeline(folder: string, repoName: string, buildNumber: string, pipeline: any) {
        if (folder) {
            var owner = this.nodes.get(folder);
            if (!owner) {
                owner = new OwnerNode(addChildUrl(this.resource, folder), this, folder);
                this.nodes.set(folder, owner);
            }
            owner.upsertPipeline(repoName, buildNumber, pipeline);
        }
    }

    deletePipeline(folder: string, repoName: string, buildNumber: string, pipeline: any) {
        if (folder) {
            var owner = this.nodes.get(folder);
            if (owner) {
                owner.deletePipeline(repoName, buildNumber, pipeline);
                if (owner.isEmpty()) {
                    this.nodes.delete(folder);
                }
            }
        }
    }

    public connect() {
        let kc = new k8s.KubeConfig();
        let configFile = process.env['HOME'] + '/.kube/config';
        try {
            kc.loadFromFile(configFile);
        } catch (e) {
            console.log('error reading ' + configFile + ': ' + e.message);
            throw e;
        }

        let watch = new k8s.Watch(kc);
        watch.watch('/apis/jenkins.io/v1/namespaces/jx/pipelineactivities',
            // optional query parameters can go here.
            // TODO filter on labels once we add them to Activities
            {},
            // callback is called for each received object.
            (type: any, obj: any) => {
                let name = obj.metadata.name;
                let spec = obj.spec;

                if (!name || !spec) {
                    return;
                }

                let buildNumber = spec.build;
                if (!buildNumber) {
                    console.log("missing build number: " + buildNumber + " for name: " + name);
                    return;
                }
                let folder = spec.gitOwner;
                let repoName = spec.gitRepository;
                if (!folder || !repoName) {
                    let pipeline = spec.pipeline;
                    if (pipeline) {
                        let values = pipeline.split("/");
                        if (values && values.length > 2) {
                            folder = values[0];
                            repoName = values[1];
                        }
                    }
                }
                if (!folder || !repoName) {
                    console.log("missing data for pipeline folder: " + folder + " repo: " + repoName + " build: " + buildNumber);
                    return;
                }

                if (type === 'ADDED' || type === 'MODIFIED') {
                    this.upsertPipeline(folder, repoName, buildNumber, obj);
                    this.fireChangeEvent();
                } else if (type === 'DELETED') {
                    this.deletePipeline(folder, repoName, buildNumber, obj);
                    this.fireChangeEvent();
                }
            },
            // done callback is called if the watch terminates normally
            (err: any) => {
                console.log(`Jenkins X Pipeline watcher got error callback ${err}`);
            });
    }

    fireChangeEvent() {
        this._onDidChangeTreeData.fire();
    }


    public getContent(resource: Uri): Thenable<string> {
        return new Promise((c, e) => {
            return c("This is some generated pipeline text");
        });
    }
}

export class PipelineTreeDataProvider implements TreeDataProvider<ModelNode>, TextDocumentContentProvider {

    constructor(private readonly model: PipelineModel) { }

    public refresh(): any {
        this.model.fireChangeEvent();
    }

    get onDidChangeTreeData(): Event<any> {
        return this.model.onDidChangeTreeData;
    }

    public getTreeItem(element: ModelNode): TreeItem {
        const contextValue = element.contextValue;
        let answer: TreeItem = {
            label: element.label,
            resourceUri: element.resource,
            contextValue: contextValue,
            tooltip: element.tooltip,
            collapsibleState: element.isDirectory ? TreeItemCollapsibleState.Collapsed : void 0
        };
        let iconPath = element.iconPath;
        if (iconPath) {
            answer.iconPath = vscode.Uri.file(path.join(__dirname, "../" + iconPath));
            //console.log("__dirname is " + __dirname + " for " + iconPath + " so using " + answer.iconPath);
        }
        const commandName = element.commandName;
        if (commandName) {
            answer.command = {
                command: commandName,
                arguments: [element],
                title: element.label,
            };
        }
        return answer;
    }

    public getChildren(element?: ModelNode): ModelNode[] | Thenable<ModelNode[]> {
        return this.model.getNodeChildren(element);
    }

    public getParent(element: ModelNode): ModelNode {
        return element.parent();
    }

    public provideTextDocumentContent(uri: Uri, token: CancellationToken): ProviderResult<string> {
        return this.model.getContent(uri).then(content => content);
    }
}

export class PipelineExplorer {
    private pipelineViewer: TreeView<ModelNode>;
    private pipelineModel = new PipelineModel();
    private treeProvider = new PipelineTreeDataProvider(this.pipelineModel);
    private terminals = new TerminalCache();

    constructor() {
        this.pipelineViewer = vscode.window.createTreeView('extension.vsJenkinsXExplorer', { treeDataProvider: this.treeProvider });
    }

    subscribe(context: vscode.ExtensionContext) {
        this.pipelineModel.connect();


        return [
            vscode.workspace.registerTextDocumentContentProvider('pipeline', this.treeProvider),
            vscode.window.registerTreeDataProvider('extension.vsJenkinsXExplorer', this.treeProvider),

            vscode.commands.registerCommand('PipelineExplorer.refresh', () => this.treeProvider.refresh()),
            vscode.commands.registerCommand('PipelineExplorer.openPipelineLogURL', resource => this.openPipelineLogURL(resource)),
            vscode.commands.registerCommand('PipelineExplorer.openRepositoryURL', resource => this.openRepositoryURL(resource)),
            vscode.commands.registerCommand('PipelineExplorer.openPipelineResource', resource => this.openResource(resource)),
            vscode.commands.registerCommand('PipelineExplorer.watchBuildLog', resource => this.watchBuildLog(resource)),
            vscode.commands.registerCommand('PipelineExplorer.startPipeline', resource => this.startPipeline(resource)),
            vscode.commands.registerCommand('PipelineExplorer.stopPipeline', resource => this.stopPipeline(resource)),
            vscode.commands.registerCommand('PipelineExplorer.revealResource', () => this.reveal()),
            vscode.commands.registerCommand('PipelineExplorer.openEnvironmentApplication', resource => this.openStageNodeUrl(resource)),
            vscode.commands.registerCommand('PipelineExplorer.openPullRequest', resource => this.openStageNodeUrl(resource)),
            vscode.commands.registerCommand('PipelineExplorer.openUpdate', resource => this.openStageNodeUrl(resource)),
        ];
    }
    //    private openResource(resource?: vscode.Uri): void {

    private openStageNodeUrl(resource?: StageNode): void {
        if (resource) {
            openUrl(resource.url);
        }
    }

    private openPipelineLogURL(resource?: BuildNode): void {
        if (resource) {
            let pipeline = resource.pipeline;
            if (pipeline) {
                let spec = pipeline.spec;
                if (spec) {
                    openUrl(spec.buildLogsUrl);
                }
            }
        }
    }

    private openRepositoryURL(resource?: BuildNode): void {
        if (resource) {
            let pipeline = resource.pipeline;
            if (pipeline) {
                let spec = pipeline.spec;
                if (spec) {
                    openUrl(spec.gitUrl);
                }
            }
        }
    }

    private openResource(resource?: BuildNode): void {
        if (resource) {
            let pipeline = resource.pipeline;
            if (pipeline) {
                let spec = pipeline.spec;
                if (spec) {
                    openUrl(spec.buildUrl);
                }
            }
        }
    }

    private watchBuildLog(resource?: BuildNode): void {
        if (resource) {
            let pipeline = resource.pipeline;
            if (pipeline) {
                let spec = pipeline.spec;
                if (spec) {
                    let pipelineName = spec.pipeline;
                    if (pipelineName) {
                        let buildNumber = spec.build || "";
                        let terminalName = "Jenkins Log: " + pipelineName + " #" + buildNumber;
                        let args = ["get", "build", "log", pipelineName];
                        if (buildNumber) {
                            args.push("--build", buildNumber);
                        }
                        runJXAsTerminal(this.terminals, args, terminalName);
                    }
                }
            }
        }
    }

    private startPipeline(resource?: RepoNode | BuildNode): void {
        if (resource) {
            let pipelineName = resource.pipelineName;
            if (pipelineName) {
                let terminalName = "Jenkins X";
                let args = ["start", "pipeline", pipelineName];
                runJXAsTerminal(this.terminals, args, terminalName);
            }
        }
    }

    private stopPipeline(resource?: BuildNode): void {
        if (resource) {
            let pipeline = resource.pipeline;
            if (pipeline) {
                let spec = pipeline.spec;
                if (spec) {
                    let pipelineName = spec.pipeline;
                    if (pipelineName) {
                        let buildNumber = spec.build || "";
                        if (buildNumber) {
                            let terminalName = "Jenkins X";
                            let args = ["stop", "pipeline", pipelineName, "--build", buildNumber];
                            runJXAsTerminal(this.terminals, args, terminalName);
                        }
                    }
                }
            }
        }
    }

    private reveal(): void {
        const node = this.getNode();
        if (node) {
            this.pipelineViewer.reveal(node);
        }
    }

    private getNode(): ModelNode | null {
        if (vscode.window.activeTextEditor) {
            const uri = vscode.window.activeTextEditor.document.uri;
            if (uri.scheme === 'pipeline') {
                return nodeForUri(uri, this.pipelineModel);
            }
        }
        return null;
    }
}



export class TerminalCache {
    private terminals = new Map<string, vscode.Terminal>();

    constructor() {
        vscode.window.onDidCloseTerminal(terminal => {
            const name = terminal.name;
            let other = this.terminals.get(name);
            if (other) {
                console.log(`Detected closing terminal ${name}`);
                this.terminals.delete(name);
            }
        });
    }
    /** 
     * Lazily creates a new terminal if one does not already exist
     */
    getOrCreate(terminalName: string): vscode.Terminal {
        let terminal = this.terminals.get(terminalName);
        if (!terminal) {
            const terminalOptions = {
                name: terminalName,
                env: process.env
            };
            terminal = vscode.window.createTerminal(terminalOptions);
            this.terminals.set(terminalName, terminal);
        }
        return terminal;
    }
}


function runJXAsTerminal(terminals: TerminalCache, args: string[], terminalName: string): vscode.Terminal {
    // TODO validate jx is on the $PATH and if not install it
    let terminal = terminals.getOrCreate(terminalName);
    terminal.sendText("jx " + args.join(" "));
    terminal.show();
    return terminal;
}

function mapValuesInKeyOrder(nodes: Map<string, ModelNode>): ModelNode[] {
    let keys: string[] = [];
    nodes.forEach((value: ModelNode, key: string) => {
        keys.push(key);
    });
    keys.sort();
    let answer: ModelNode[] = [];
    keys.forEach((key: string) => {
        let value = nodes.get(key);
        if (value) {
            answer.push(value);
        }
    });
    return answer;
}

function openUrl(u?: string): void {
    if (u) {
        vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(u));
    }
}

/*
 * Returns the node for the given URI
 */
function nodeForUri(uri: vscode.Uri, node: ModelNode): ModelNode | null {
    if (!node) {
        return null;
    }
    if (node.resource === uri) {
        return node;
    }
    for (let child of node.getChildren()) {
        let answer = nodeForUri(uri, child);
        if (answer) {
            return answer;
        }
    }
    return null;
}

function stringCapitalise(text?: string): string {
    if (text) {
        return text.substring(0, 1).toUpperCase() + text.substring(1);
    }
    return "";
}

function elapsedTime(prefix: string, start?: string, completed?: string): string {
    if (start && completed) {
        let m1 = moment(start);
        let m2 = moment(completed);

        if (m1.isValid() && m2.isValid()) {
            var duration = moment.duration(m1.diff(m2));
            const answer = duration.humanize();
            if (answer) {
                return prefix + answer;
            }
        }
    }
    return "";
}

    /*
    if (await checkPresent(context, 'command')) {
        const term = context.host.createTerminal(terminalName, path(context), command);
        term.show();
    }
    */

/*
type CheckPresentMessageMode = 'command' | 'activation' | 'silent';


interface Context {
    readonly host: Host;
    readonly fs: FS;
    readonly shell: Shell;
    readonly installDependenciesCallback: () => void;
    binFound: boolean;
    binPath: string;
}

async function checkPresent(context: Context, errorMessageMode: CheckPresentMessageMode): Promise<boolean> {
    if (context.binFound) {
        return true;
    }

    return await checkForJXInternal(context, errorMessageMode);
}

async function checkForJXInternal(context: Context, errorMessageMode: CheckPresentMessageMode): Promise<boolean> {
    const binName = 'jx';
    const bin = context.host.getConfiguration('vs-kubernetes')[`vs-jx.${binName}-path`];

    const contextMessage = getCheckKubectlContextMessage(errorMessageMode);
    const inferFailedMessage = 'Could not find "jx" binary.' + contextMessage;
    const configuredFileMissingMessage = bin + ' does not exist!' + contextMessage;

    return await binutil.checkForBinary(context, bin, binName, inferFailedMessage, configuredFileMissingMessage, errorMessageMode !== 'silent');
}
*/

