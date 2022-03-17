# Configuration file for the Sphinx documentation builder.

import os, re, sys, subprocess

#-------------------------------------------------
# Set up the environment.

curdir = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, f'{curdir}/../../src')

# TODO: Currently croquis tries to start in the "normal" mode and then complains
# that it can't find Jupyter notebook, but that's probably OK.  I tried the
# following but then I can't import croquis.plot(), so it doesn't work:
#   os.environ['CROQUIS_UNITTEST'] = '1'

if 'READTHEDOCS' in os.environ:
    # Set up the environment.  See readthedocs_helper.sh for more info.
    subprocess.check_call(os.path.join(curdir, 'readthedocs_helper.sh'))

# Horrible hack: Inside readthedocs, we want to know which branch we're
# generating the documents for.  Readthedocs appends its own configuration
# *after* the contents of this file, so we read our own script to find it out.
def _get_current_readthedocs_branch():
    if 'PROJECT_VERSION' in os.environ:
        version = os.environ['PROJECT_VERSION']
        print(f'Environment variable PROJECT_VERSION is {version}.')
        return f'v{version}'

    with open(__file__, 'rt') as f:
        for line in f:
            m = re.search(r"'github_version': *'(.*)'", line)
            if m: return m.group(1)

    return 'master'

_my_current_branch = _get_current_readthedocs_branch()

#-------------------------------------------------
# Project information.

project = 'Croquis'
copyright = '2021-2022, Yongjik Kim'
author = 'Yongjik Kim'

version = 'latest' if _my_current_branch == 'master' else _my_current_branch

#-------------------------------------------------
# General configuration.

# Add any Sphinx extension module names here, as strings. They can be
# extensions coming with Sphinx (named 'sphinx.ext.*') or your custom
# ones.
extensions = [
    'sphinx.ext.autodoc',
    'sphinx.ext.extlinks',
    'sphinx.ext.intersphinx',
]

extlinks = {
    'githublink': (
        f'https://github.com/yongjik/croquis/blob/{_my_current_branch}/%s',
        'file %s',
    ),
}

intersphinx_mapping = {
    'python': ('https://docs.python.org/3/', None),
}

# Add any paths that contain templates here, relative to this directory.
templates_path = ['_templates']

# List of patterns, relative to source directory, that match files and
# directories to ignore when looking for source files.
# This pattern also affects html_static_path and html_extra_path.
exclude_patterns = []

#-------------------------------------------------
# Options for HTML output.

# Copied from readthedocs' default setup.
html_theme = 'sphinx_rtd_theme'

# Add any paths that contain custom static files (such as style sheets) here,
# relative to this directory. They are copied after the builtin static files,
# so a file named "default.css" will overwrite the builtin "default.css".
# html_static_path = ['_static']
