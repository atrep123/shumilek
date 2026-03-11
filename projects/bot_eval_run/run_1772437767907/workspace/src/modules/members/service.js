module.exports = {
  addMember(member) {
    if (!member || !member.userId || !member.role) {
      throw new BadRequestError('Invalid member data');
    }
    // Add member logic here
  },
};
