# Miscellaneous functions.

# Check that `kwargs` is empty.  Used to dynamically parse named arguments.
def check_empty(kwargs):
    if len(kwargs) > 0:
        raise TypeError(f'Unexpected keyword arguments: {list(kwargs)}')
