#!/usr/bin/env python3
"""Builds the iPhone Shortcut that puts Fine Print in the Share menu, then signs it so it imports with one tap.

It takes whatever is shared (a link, a Safari page or text), finds the link, and opens
https://fineprint.buildtube.app/?url=<that link>. Signing needs a Mac signed in to an Apple ID.

    python3 scripts/build-shortcut.py            # writes public/get/fine-print.shortcut
    python3 scripts/build-shortcut.py https://my-copy.example.com
"""
import os, plistlib, subprocess, sys, tempfile, uuid

site = (sys.argv[1] if len(sys.argv) > 1 else 'https://fineprint.buildtube.app').rstrip('/')
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(root, 'public', 'get', 'fine-print.shortcut')

find_links, encode, open_url = (str(uuid.uuid4()).upper() for _ in range(3))
prefix = f'{site}/?url='
shortcut = {
    'WFWorkflowClientVersion': '2607.0.2',
    'WFWorkflowMinimumClientVersion': 900,
    'WFWorkflowMinimumClientVersionString': '900',
    'WFWorkflowIcon': {'WFWorkflowIconStartColor': 4282601983, 'WFWorkflowIconGlyphNumber': 59511},
    'WFWorkflowTypes': ['ActionExtension'],  # show in the Share menu
    'WFWorkflowInputContentItemClasses': ['WFURLContentItem', 'WFSafariWebPageContentItem', 'WFStringContentItem'],
    'WFWorkflowHasShortcutInputVariables': True,
    'WFWorkflowImportQuestions': [],
    'WFQuickActionSurfaces': [],
    'WFWorkflowOutputContentItemClasses': [],
    'WFWorkflowActions': [
        {'WFWorkflowActionIdentifier': 'is.workflow.actions.detect.link',
         'WFWorkflowActionParameters': {'UUID': find_links, 'WFInput': {'Value': {'Type': 'ExtensionInput'}, 'WFSerializationType': 'WFTextTokenAttachment'}}},
        {'WFWorkflowActionIdentifier': 'is.workflow.actions.urlencode',
         'WFWorkflowActionParameters': {'UUID': encode, 'WFInput': {'Value': {'Type': 'ActionOutput', 'OutputUUID': find_links, 'OutputName': 'URLs'}, 'WFSerializationType': 'WFTextTokenAttachment'}}},
        {'WFWorkflowActionIdentifier': 'is.workflow.actions.openurl',
         'WFWorkflowActionParameters': {'UUID': open_url, 'WFInput': {'Value': {
             'string': prefix + '￼',
             'attachmentsByRange': {f'{{{len(prefix)}, 1}}': {'Type': 'ActionOutput', 'OutputUUID': encode, 'OutputName': 'URL Encoded Text'}},
         }, 'WFSerializationType': 'WFTextTokenString'}}},
    ],
}

with tempfile.TemporaryDirectory() as tmp:
    unsigned = os.path.join(tmp, 'Fine Print.shortcut')
    with open(unsigned, 'wb') as f:
        plistlib.dump(shortcut, f, fmt=plistlib.FMT_BINARY)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    subprocess.run(['shortcuts', 'sign', '--mode', 'anyone', '--input', unsigned, '--output', out], check=True, stderr=subprocess.DEVNULL)
print(f'Signed shortcut written to {os.path.relpath(out, root)} (opens {prefix}…)')
