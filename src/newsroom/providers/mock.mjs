export async function generateMock({fixture}){
  return {value:structuredClone(fixture),usage:{inputTokens:10,outputTokens:20,totalTokens:30},model:'mock-sintetico',requestId:'mock-sintetico',provider:'mock',synthetic:true};
}
