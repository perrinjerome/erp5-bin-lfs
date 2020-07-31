# Purpose

This repository is used for put the business template which not suitable to put
in the main nexedi/erp5 repository, such as files generated as a result of
compilation (for example: python modules compiled as web assembly) or large
files that would prevent mirroring on github (because github refuses git
objects larger than 100MB).

SlapOS was configured to use erp5-bin as external repository:
https://lab.nexedi.com/nexedi/slapos/blob/d1bd018c/stack/erp5/buildout.cfg#L346

So this external library was managed by SlapOS. Updating work also done by SlapOS.

# Submodule

Use git submodule needs to pin a revision in the main erp5 repository. Each time
we commit something to the submodule, we also need to update the revision, which
add a redundent commit in the main erp5 repository.

If we use submodule, people have two choices. The first one is to execute git
commands from terminals. The second one is improve the erp5_forge bt. Which also
bring a new issue: When checkout branch in erp5 repository, how to handle the
submodule. Add a hook like post-call to re-initialize the submodule, or done it
manually from command line?

Last but not least. The submodule not managed by SlapOS. Use external repository
can force people to use SlapOS.